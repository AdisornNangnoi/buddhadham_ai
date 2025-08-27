// src/api/chat.js
import { chatClient, qNaClient } from "./client";

/* ======================= helpers ======================= */
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// single-flight control สำหรับ askQuestion
let inflightController = null;
// ป้องกันยิงถี่เกิน
let lastFiredAt = 0;
const MIN_COOLDOWN_MS = 500;

// ชุดข้อความที่บอกว่าเป็น error ชั่วคราว/เครือข่าย
const TEMP_ERROR_SNIPPETS = [
  "Timed out fetching a new connection from the connection pool",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNABORTED",
  "socket hang up",
  "Network Error",
];

/* ======================= QnA: ถามคำถาม ======================= */
/**
 * ยิงถาม-ตอบไปที่ `${API}/qNa/ask`
 * - ถ้า guest ให้ส่งโดยไม่ใส่ chatId
 * - กันคำถามว่าง/ยาวเกิน/เว้นวรรคอย่างเดียว ตั้งแต่ฝั่ง client
 * - clamp k,d ก่อนส่ง (ป้องกันค่าหลุด)
 * - ยกเลิก request เดิมถ้ามี (ป้องกันยิงค้าง), timeout + retry แบบ backoff
 */
export const askQuestion = async ({ chatId, question, k, d }) => {
  const q = (question ?? "").trim();

  // guard: empty / whitespace-only
  if (!q) {
    return {
      message: "Answered without saving (blank question, client guarded)",
      data: { savedRecordQuestion: null, savedRecordAnswer: null },
      answer: "กรุณาพิมพ์คำถาม",
      references: "ไม่มี",
      rejected: true,
      duration: 0,
    };
  }

  // guard: ยาวเกินไป
  const MAX_QUESTION_LEN = 4000;
  if (q.length > MAX_QUESTION_LEN) {
    return {
      message: "Answered without saving (question too long)",
      data: { savedRecordQuestion: null, savedRecordAnswer: null },
      answer: `คำถามยาวเกินไป (${q.length}/${MAX_QUESTION_LEN} ตัวอักษร)`,
      references: "ไม่มี",
      rejected: true,
      duration: 0,
    };
  }

  // client-side cooldown
  const now = Date.now();
  const delta = now - lastFiredAt;
  if (delta < MIN_COOLDOWN_MS) {
    await sleep(MIN_COOLDOWN_MS - delta);
  }
  lastFiredAt = Date.now();

  // payload
  const payload = {
    question: q,
    ...(chatId != null ? { chatId } : {}),
    ...(k != null ? { k: clamp(parseInt(k, 10) || 3, 1, 50) } : {}),
    ...(d != null ? { d: clamp(Number(d) || 0.75, 0, 1) } : {}),
  };

  // ยกเลิก request ก่อนหน้า ถ้ามี
  if (inflightController) {
    try { inflightController.abort(); } catch {}
  }
  inflightController = new AbortController();

  // retry policy
  const MAX_RETRIES = 2;
  const BASE_TIMEOUT_MS = 25000; // 25s
  const BASE_BACKOFF_MS = 600;   // 600, 1200

  let attempt = 0;
  while (true) {
    try {
      // qNaClient baseURL = `${API}/qNa` → path ใช้ "/ask" พอ
      const { data } = await qNaClient.post("/ask", payload, {
        signal: inflightController.signal,
        timeout: BASE_TIMEOUT_MS,
      });
      inflightController = null;
      return data;
    } catch (err) {
      const isAbort = err?.name === "AbortError" || err?.message === "canceled";
      if (isAbort) {
        return {
          message: "Answered without saving (request aborted)",
          data: { savedRecordQuestion: null, savedRecordAnswer: null },
          answer: "ยกเลิกคำขอก่อนหน้าแล้ว ยิงคำถามล่าสุดแทน",
          references: "ไม่มี",
          rejected: true,
          duration: 0,
        };
      }

      const status = err?.response?.status;
      const msg = String(err?.response?.data?.message || err?.message || "");

      const looksTemporary =
        status === 429 || status === 503 ||
        TEMP_ERROR_SNIPPETS.some((s) => msg.includes(s));

      if (looksTemporary && attempt < MAX_RETRIES) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
        attempt += 1;
        await sleep(backoff);
        continue;
      }

      return {
        message: "Answered without saving (request failed)",
        data: { savedRecordQuestion: null, savedRecordAnswer: null },
        answer:
          status === 429
            ? "คำถามเยอะเกินไปชั่วคราว กรุณาลองใหม่อีกครั้ง"
            : "เกิดข้อผิดพลาดขณะส่งคำถาม กรุณาลองใหม่",
        references: "ไม่มี",
        rejected: true,
        duration: 0,
        debug: { status, error: msg, attempt },
      };
    }
  }
};

/* ======================= Chats: CRUD/Fetch ======================= */
/**
 * ดึงรายชื่อแชตของผู้ใช้
 * GET /chat/all/:userId
 * คืน array ของแชต (ต้องมีอย่างน้อย chatId, chatHeader)
 */
export const getUserChats = async (userId) => {
  if (!userId) return [];
  const { data } = await chatClient.get(`/all/${userId}`);
  return Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
};

/**
 * สร้างแชตใหม่
 * POST /chat/
 * body: { chatHeader }
 * คืน object แชตที่สร้าง
 */
export const createChat = async ({ chatHeader }) => {
  if (!chatHeader || !String(chatHeader).trim()) {
    throw new Error("chatHeader is required");
  }
  const { data } = await chatClient.post(`/`, { chatHeader: String(chatHeader).trim() });
  return data?.data ?? data;
};

/**
 * แก้ไขแชต
 * PUT /chat/:chatId
 * body: ตาม controller (ปัจจุบันรองรับ chatMessage, userId, chatImage)
 */
export const editChat = async (chatId, updatedData) => {
  if (!chatId) throw new Error("chatId is required");
  const { data } = await chatClient.put(`/${chatId}`, updatedData || {});
  return data?.data ?? data;
};

/**
 * ลบแชต
 * DELETE /chat/:chatId
 */
export const deleteChat = async (chatId) => {
  if (!chatId) throw new Error("chatId is required");
  const { data } = await chatClient.delete(`/${chatId}`);
  return data?.data ?? data;
};

/**
 * ดึงแชตเดี่ยว (พร้อมข้อมูล user ตามที่ controller include)
 * GET /chat/one/:chatId
 */
export const getChatById = async (chatId) => {
  if (!chatId) return null;
  const { data } = await chatClient.get(`/one/${chatId}`);
  // controller ส่ง { data: { chat, user } } → คืนตามนั้น
  return data?.data ?? data;
};

/**
 * ดึงแชตทั้งหมด (admin/debug)
 * GET /chat/all
 */
export const getAllChats = async () => {
  const { data } = await chatClient.get(`/all`);
  return Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
};

/* ======================= QnA history per chat ======================= */
/**
 * ดึงประวัติ Q/A ของห้อง
 * GET /qNa/list/:chatId
 * คืนเป็น array ของ qNa rows { qNaId, qNaWords, qNaType, createdAt }
 */
// ดึงประวัติ Q/A ของห้อง
export const getChatQna = async (chatId) => {
  if (!chatId) return [];
  try {
    // ⬅️ server ใช้ GET /qNa/:chatId (ไม่ใช่ /list/:chatId)
    const { data } = await qNaClient.get(`/${chatId}`);
    return Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  } catch (err) {
    if (err?.response?.status === 404) return []; // กันหน้าแตก
    throw err;
  }
};

