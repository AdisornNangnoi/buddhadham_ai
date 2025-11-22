import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";

import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  KeyboardAvoidingView,
  ToastAndroid,
} from "react-native";

import { useFocusEffect } from "@react-navigation/native";
import Markdown from "react-native-markdown-display";
import Icon from "react-native-vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";

import { useAuth } from "../src/auth/AuthContext";
import { useWS } from "../src/hooks/WSContext";
import useThemePreference from "../src/hooks/useThemePreference";

import buddhadhamBG from "../assets/buddhadham.png";
import userAvatar from "../assets/userAvatar.png";
import botAvatar from "../assets/botAvatar.png";

import {
  askQuestion,
  cancelAsk,
  createChat,
  deleteChat as apiDeleteChat,
  editChat as apiEditChat,
  getChatQna,
  getUserChats,
  checkStatus,
  saveAnswer,
} from "../src/api/chat";

import { EXPO_PUBLIC_API_URL } from "@env";
import AsyncStorage from "@react-native-async-storage/async-storage";

/* =============== Constants =============== */
const MIN_H = 40;
const MAX_H = 140;
const LINE_H = 20;
const PAD_V_TOP = 10;
const PAD_V_BOTTOM = 10;
const EXTRA_BOTTOM_GAP = 0;

const AVATAR_SIZE = 44;
const CORNER_NEAR_AVATAR = 6;

const STORAGE_PREFIX = "chat_state_v1:";
const LAST_CHAT_ID_KEY = "last_selected_chat_id";

const MAX_ATTACHMENT_BYTES = 100 * 1024;
const SERVER_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const FRONTEND_BODY_LIMIT_BYTES = Math.floor(
  SERVER_BODY_LIMIT_BYTES * 0.9
);

const SUPPORTED_MIME = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/*",
];
/* =============== Utils =============== */

// บังคับความสูง textarea ให้อยู่ในช่วงที่กำหนด
const clampH = (h) =>
  Math.min(MAX_H, Math.max(MIN_H, Math.ceil(h || MIN_H)));

// แปลงเป็น timestamp แบบ number
const toTS = (v) =>
  v ? (typeof v === "number" ? v : Date.parse(v)) || 0 : 0;

// แปลง timestamp → วันที่ภาษาไทย
const formatTS = (d) =>
  new Date(d).toLocaleString("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

// ข้ามแพลตฟอร์มแจ้งเตือน
const notify = (titleOrMsg, msg) => {
  const text = msg ? `${titleOrMsg}\n${msg}` : String(titleOrMsg);

  if (Platform.OS === "web") {
    try { window.alert(text); } catch {}
    return;
  }

  if (Platform.OS === "android") {
    try { ToastAndroid.show(text, ToastAndroid.SHORT); } catch {}
    return;
  }

  Alert.alert(titleOrMsg, msg);
};

// เดา mime จากนามสกุลไฟล์
const inferMimeFromName = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
  };
  return map[ext] || "text/plain";
};

// คำนวณ byte length ของ UTF-8 string
const utf8ByteLength = (str) => {
  try {
    if (typeof TextEncoder !== "undefined")
      return new TextEncoder().encode(str || "").length;
  } catch {}

  const s = String(str || "");
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes += c <= 0x7f ? 1 : c <= 0x7ff ? 2 : 3;
  }
  return bytes;
};

// ตัดเนื้อหาไฟล์ออกจากข้อความ (ไว้แสดงใน UI history เท่านั้น)
const toDisplayQuestionOnly = (text) => {
  if (!text) return "";
  const s = String(text);

  const newMark = "(ไฟล์แนบ:";
  const n = s.indexOf(newMark);
  if (n >= 0) {
    const close = s.indexOf(")", n);
    return (close >= 0 ? s.slice(0, close + 1) : s.slice(0, n) + ")").trim();
  }

  const sep = "\n---\n";
  const idx = s.indexOf(sep);
  if (idx >= 0) {
    const anchor = "📎 เนื้อหาไฟล์แนบ (";
    const aIdx = s.indexOf(anchor, idx + sep.length);
    if (aIdx >= 0) {
      const end = s.indexOf(")", aIdx);
      const q = s.slice(0, idx).trim();
      const fileLabel = end >= 0 ? s.slice(aIdx, end + 1) : s.slice(aIdx);
      return (q ? q + "\n\n" : "") + fileLabel.replace("เนื้อหาไฟล์แนบ", "ไฟล์แนบ");
    }
    return s.slice(0, idx).trim();
  }
  return s;
};

// รวมข้อความ + เนื้อหาไฟล์ เพื่อส่ง API
const buildFullQuestion = (rawText, attachName, attachTextTrim) => {
  const hasText = !!(rawText && rawText.trim());
  const hasAttach = !!(attachTextTrim && attachTextTrim.trim());

  if (!hasAttach) return (rawText || "").trim();

  const head = hasText
    ? rawText.trim()
    : `(ไฟล์แนบ: ${attachName})`;

  return `${head}\n\n---\n📎 เนื้อหาไฟล์แนบ (${attachName}):\n${attachTextTrim.trim()}`;
};

// ประมาณขนาด Payload JSON ที่จะส่ง backend
const estimatePayloadBytes = ({ chatId, question, dbSaveHint }) =>
  utf8ByteLength(
    JSON.stringify({
      ...(chatId ? { chatId } : {}),
      question,
      ...(dbSaveHint ? { dbSaveHint } : {}),
    })
  );

/* =============== Storage Wrapper =============== */

const storage = {
  async getItem(key) {
    try {
      if (AsyncStorage?.getItem) return await AsyncStorage.getItem(key);
    } catch {}

    if (Platform.OS === "web") {
      try { return window.localStorage.getItem(key); } catch {}
    }
    return null;
  },

  async setItem(key, val) {
    try {
      if (AsyncStorage?.setItem) return await AsyncStorage.setItem(key, val);
    } catch {}

    if (Platform.OS === "web") {
      try { window.localStorage.setItem(key, val); } catch {}
    }
  },
};

/* =============== MessageItem Component =============== */

const MessageItem = ({ item, isDark, styles: S }) => {
  const isUser = item.from === "user";
  const isPending = item.pending === true;

  return (
    <View style={[S.msgRow, isUser ? S.rowR : S.rowL]}>
      <View style={S.avatarWrap}>
        <Image
          source={isUser ? userAvatar : botAvatar}
          style={S.avatarImg}
          resizeMode="cover"
        />
      </View>

      <View>
        <View
          style={[
            S.messageWrapper,
            isUser ? S.bubbleUser : S.bubbleBot,
          ]}
        >
          {isPending ? (
            <View style={S.pendingRow}>
              <ActivityIndicator color={isDark ? "#fff" : "#000"} />
              <Text style={isUser ? S.bubbleUserText : S.bubbleBotText}>
                กำลังประมวลผล...
              </Text>
            </View>
          ) : (
            <Markdown
              style={{
                body: isUser ? S.mdBodyUser : S.mdBodyBot,
                strong: isUser ? S.mdStrongUser : S.mdStrongBot,
                em: isUser ? S.mdEmUser : S.mdEmBot,
                code_block: S.mdCodeBlock,
                blockquote: S.mdBlockquote,
              }}
            >
              {item.text}
            </Markdown>
          )}
        </View>

        <Text
          style={[
            S.timeText,
            isUser ? S.alignRight : S.alignLeft,
          ]}
        >
          {item.time}
        </Text>
      </View>
    </View>
  );
};

/* =============== Main Component =============== */
export default function ChatScreen({ navigation }) {
  // WebSocket context สำหรับรับ event/stream
  const { on, subscribeTask } = useWS();
  // Auth context: ข้อมูล user และฟังก์ชัน logout
  const { user, logout } = useAuth();
  // ให้ SafeArea ทำงานถูก (เราไม่ใช้ค่า insets โดยตรง)
  useSafeAreaInsets();

  /* =============== Theme =============== */
  // ธีม Light/Dark + ชุดสี C สำหรับใช้ใน style
  const { isDark, toggleTheme, C } = useThemePreference("chat");

  /* =============== Global sending/pending state =============== */
  const [sending, setSending] = useState(false); // ตอนนี้กำลังมีคำถามที่รอคำตอบอยู่หรือไม่
  const awaitingRef = useRef(false); // mirror ของ sending ในรูป ref
  useEffect(() => {
    awaitingRef.current = sending;
  }, [sending]);

  const [showStop, setShowStop] = useState(false); // ให้แสดงปุ่มหยุด/ยกเลิกหรือยัง
  const stopTimerRef = useRef(null); // timer สำหรับหน่วงเวลาแสดงปุ่ม stop

  const [currentTaskId, setCurrentTaskId] = useState(null); // taskId ปัจจุบันที่รอ backend
  const currentTaskIdRef = useRef(null); // ref ของ currentTaskId (ใช้ใน callback ที่ไม่ re-render)
  useEffect(() => {
    currentTaskIdRef.current = currentTaskId;
  }, [currentTaskId]);

  const [pendingQnaId, setPendingQnaId] = useState(null); // id record Q ฝั่ง backend ที่กำลังรอ A
  const [pendingUserMsgId, setPendingUserMsgId] = useState(null); // id ของ message ฝั่ง user ที่ pending อยู่

  /* =============== UI state =============== */
  const [messages, setMessages] = useState([]); // messages ทั้งหมดของห้องปัจจุบัน
  const [inputText, setInputText] = useState(""); // ข้อความใน input
  const [sidebarOpen, setSidebarOpen] = useState(false); // sidebar เปิด/ปิด
  const sidebarAnim = useState(new Animated.Value(-260))[0]; // ค่า animation สำหรับ slide sidebar
  const [inputHeight, setInputHeight] = useState(MIN_H); // ความสูง textarea (บน web)
  const [inputBarH, setInputBarH] = useState(0); // ความสูงของแถบ input (ใช้ขยับ chip attachment)

  // ใช้ขนาดหน้าจอเพื่อคำนวณความกว้าง bubble แชท
  const screenW = Dimensions.get("window").width;
  const ROW_HPAD = 10;
  const GAP_BETWEEN = 10;
  const HALF_W = Math.floor(screenW * 0.4) - (ROW_HPAD + GAP_BETWEEN);
  const BUBBLE_MAX_W = Math.max(HALF_W);

  // ใช้เลื่อน bubble ให้มุมเข้ามาใกล้ avatar ดูเป็น speech bubble
  const cornerShift = AVATAR_SIZE / 2 - CORNER_NEAR_AVATAR;

  // รวม style ทั้งหมด โดยพึ่งพา theme/height/ความกว้าง
  const S = useMemo(
    () => makeStyles(C, isDark, inputHeight, BUBBLE_MAX_W, cornerShift),
    [C, isDark, inputHeight, BUBBLE_MAX_W, cornerShift]
  );

  const listRef = useRef(null); // ref ไปยัง FlatList
  const shouldScrollRef = useRef(false); // flag ว่าควร auto scroll ไปล่างสุดเมื่อ content เปลี่ยนไหม

  // ฟังก์ชัน scroll ลงล่างสุดของแชท
  const scrollToBottom = (animated = true, resetFlag = false) => {
    if (!listRef.current) return;

    try {
      listRef.current.scrollToOffset({
        offset: Number.MAX_SAFE_INTEGER, // เลื่อนไป offset ใหญ่มาก = ล่างสุด
        animated,
      });
    } catch (e) {
      console.warn("scrollToBottom error:", e);
    }

    if (resetFlag) {
      shouldScrollRef.current = false;
    }
  };

  /* =============== Chats (list, selection, rename, delete) =============== */
  const [chats, setChats] = useState([]); // รายชื่อห้องแชททั้งหมดของ user
  const [selectedChatId, setSelectedChatId] = useState(null); // id ห้องปัจจุบันที่เลือกอยู่
  const selectedChatIdRef = useRef(null); // ref mirror ของ selectedChatId
  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  const [loadingChats, setLoadingChats] = useState(false); // กำลังโหลด list ห้องแชท
  const [loadingHistory, setLoadingHistory] = useState(false); // กำลังโหลดประวัติข้อความของห้องนี้

  const [menuFor, setMenuFor] = useState(null); // id ของห้องที่กำลังเปิด popup menu (สามจุด)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 }); // ตำแหน่งที่จะแสดง popup menu
  const [editingId, setEditingId] = useState(null); // id ห้องที่กำลัง rename inline
  const [editingText, setEditingText] = useState(""); // ข้อความชื่อห้องตอนกำลังแก้

  // ใช้กันไม่ให้ effect persist state รันระหว่าง loadHistory (กัน loop)
  const persistSuspendedRef = useRef(false);

  /* =============== textarea auto height (web) =============== */
  const webRef = useRef(null); // ref ไปยัง DOM <textarea> (เฉพาะบน web)

  const adjustWebHeight = () => {
    if (Platform.OS !== "web") return;
    const el = webRef.current;
    if (!el) return;

    // ให้ textarea คำนวณความสูงจริงจาก scrollHeight แล้ว clamp
    el.style.height = "auto";
    const next = clampH(el.scrollHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = next >= MAX_H ? "auto" : "hidden";
    setInputHeight(next);
  };

  // เรียกตอน mount ครั้งแรกถ้าอยู่บน web เพื่อให้ความสูงเริ่มต้นถูกต้อง
  useEffect(() => {
    if (Platform.OS === "web") adjustWebHeight();
  }, []);

  /* =============== Attachment =============== */
  const [attachment, setAttachment] = useState(null); // ข้อมูลไฟล์แนบปัจจุบัน

  // เปิด DocumentPicker ให้ user เลือกไฟล์ข้อความ
  const pickAttachment = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: SUPPORTED_MIME,
      });

      if (res.canceled) return; // user กดยกเลิก
      const f = res.assets?.[0];
      if (!f) return;

      const { name, size: sizeFromPicker, mimeType, uri } = f;

      // เดา mime ถ้า DocumentPicker ไม่ให้มา
      const mime = mimeType || inferMimeFromName(name);

      // ตรวจว่า mime อยู่ใน SUPPORTED_MIME (รองรับ text/*)
      const okType = SUPPORTED_MIME.some((m) =>
        m.endsWith("/*") ? mime.startsWith(m.replace("/*", "")) : m === mime
      );
      if (!okType) {
        return notify(
          "ไม่รองรับไฟล์",
          "แนบได้เฉพาะไฟล์ข้อความ (.txt, .md, .csv, .json, .xml)"
        );
      }

      let size = typeof sizeFromPicker === "number" ? sizeFromPicker : null;

      // ถ้ายังไม่รู้ขนาดไฟล์แน่ชัด ลองหาจาก blob / FileSystem
      try {
        if (Platform.OS === "web") {
          const blob = await (await fetch(uri)).blob();
          if (!size) size = blob.size;
        } else {
          const FileSystem = require("expo-file-system");
          const info = await FileSystem.getInfoAsync(uri, { size: true });
          if (!size) size = typeof info.size === "number" ? info.size : null;
        }
      } catch {}

      // validate ขนาดไฟล์
      if (!size || size <= 0) {
        return notify("ไฟล์ว่าง", "ไฟล์ที่เลือกมีขนาด 0 ไบต์");
      }
      if (size > MAX_ATTACHMENT_BYTES) {
        const kb = (size / 1024).toFixed(0);
        const limitKb = (MAX_ATTACHMENT_BYTES / 1024).toFixed(0);
        return notify(
          "ไฟล์ใหญ่เกินไป",
          `ขนาด ${kb}KB เกินลิมิต ${limitKb}KB — ไม่สามารถแนบได้`
        );
      }

      // อ่านเนื้อหาไฟล์เป็น string UTF-8
      let text = "";
      if (Platform.OS === "web") {
        text = await new Promise((resolve, reject) => {
          fetch(uri)
            .then((r) => r.blob())
            .then((blob) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result || "");
              reader.onerror = reject;
              reader.readAsText(blob);
            })
            .catch(reject);
        });
      } else {
        const FileSystem = require("expo-file-system");
        text = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      if (!text || !String(text).trim()) {
        return notify("ไฟล์ว่าง", "ไม่พบเนื้อหาในไฟล์ที่เลือก");
      }

      const attachTextTrim = String(text).trim();

      // สร้างตัวอย่างคำถามเต็ม (ข้อความ + เนื้อหาไฟล์) เพื่อเช็คขนาด payload
      const previewFullQuestion = buildFullQuestion(
        inputText,
        name,
        attachTextTrim
      );

      const projectedBytes = estimatePayloadBytes({
        chatId: user ? selectedChatIdRef.current : undefined,
        question: previewFullQuestion,
        dbSaveHint: { fileName: name, fileText: attachTextTrim },
      });

      if (projectedBytes > FRONTEND_BODY_LIMIT_BYTES) {
        const mb = (projectedBytes / 1024 / 1024).toFixed(2);
        const mbLimit = (
          FRONTEND_BODY_LIMIT_BYTES /
          1024 /
          1024
        ).toFixed(2);
        return notify(
          "ข้อความรวมใหญ่เกินไป",
          `ประมาณ ${mb}MB > ${mbLimit}MB — ลดขนาดไฟล์หรือข้อความก่อนแนบ`
        );
      }

      // ผ่านทุกเงื่อนไข → เซตเป็น attachment ที่พร้อมใช้งาน
      setAttachment({ name, size, mime, text: String(text) });
    } catch (e) {
      console.warn("pickAttachment error:", e);
      notify("ผิดพลาด", "เลือกไฟล์ไม่สำเร็จ");
    }
  };

  // ล้างไฟล์แนบออก
  const removeAttachment = () => setAttachment(null);
    /* =============== Pending bubble helpers =============== */

  // สร้าง id ของ bubble pending จาก taskId
  const pendingBubbleId = (taskId) => `pending-${taskId}`;

  // สร้าง message bubble แบบ pending ของบอท
  const makePendingBubble = (taskId) => ({
    id: taskId ? pendingBubbleId(taskId) : "pending-generic",
    from: "bot",
    pending: true,
    text: "กำลังประมวลผล...",
    time: formatTS(Date.now()),
  });

  // เพิ่ม bubble pending (ถ้ายังไม่มีอันเดียวกันอยู่แล้ว)
  const addPendingBotBubble = (taskId) => {
    const id = taskId ? pendingBubbleId(taskId) : "pending-generic";
    setMessages((prev) =>
      prev.some((m) => m.id === id) ? prev : [...prev, makePendingBubble(taskId)]
    );
  };

  // ลบ bubble pending (ตาม taskId ถ้ามี, ถ้าไม่มีก็ลบ pending อันแรกที่เจอ)
  const removePendingBotBubble = (taskId) => {
    setMessages((prev) => {
      if (taskId) return prev.filter((m) => m.id !== pendingBubbleId(taskId));
      const idx = prev.findIndex((m) => m.pending === true);
      if (idx < 0) return prev;
      const copy = [...prev];
      copy.splice(idx, 1);
      return copy;
    });
  };

  // upgrade จาก "pending-generic" → "pending-<taskId>" เมื่อรู้ taskId แน่ชัด
  const upgradePendingBubble = (taskId) => {
    if (!taskId) return;
    setMessages((prev) => {
      const genIdx = prev.findIndex(
        (m) => m.pending === true && m.id === "pending-generic"
      );
      if (genIdx === -1) return prev;
      const copy = [...prev];
      copy.splice(genIdx, 1, {
        ...prev[genIdx],
        id: `pending-${taskId}`,
      });
      return copy;
    });
  };

  /* =============== WS streaming result → replace pending bubble =============== */

  // ฟัง event "done" จาก WebSocket → ถ้า task นี้/ห้องนี้เสร็จแล้ว → reset pending state
  useEffect(() => {
    const doneHandler = (payload) => {
      const matchesTask =
        !!payload?.taskId && payload.taskId === currentTaskIdRef.current;
      const matchesChat =
        !!payload?.chatId &&
        String(payload.chatId) === String(selectedChatIdRef.current);

      if (!matchesTask && !matchesChat) return;

      // เป็น "done" ของงานที่เรารออยู่ → reset pending
      hardResetPendingState();
    };

    const unbind = on("done", doneHandler);
    return () => unbind?.();
  }, [on]);

  // subscribeTask เพื่อรับข้อความ stream แล้วแทน bubble pending ด้วยคำตอบ
  useEffect(() => {
    const taskId = currentTaskIdRef.current;
    if (!taskId) return;

    const handler = (msgObj) => {
      // มีข้อความใหม่ → ถ้าอยู่ล่างสุดแล้วให้ auto scroll ต่อได้
      shouldScrollRef.current = true;

      const matchesTask =
        !!msgObj?.taskId && msgObj.taskId === currentTaskIdRef.current;
      const matchesChat =
        !!msgObj?.chatId &&
        String(msgObj.chatId) === String(selectedChatIdRef.current);

      let accept = matchesTask || matchesChat;
      // ถ้ายังส่งอยู่ (awaitingRef.current) ก็ยอมรับแม้ taskId/chatId ไม่ตรง
      if (!accept && awaitingRef.current) accept = true;
      if (!accept) return;

      // ดึง text ที่จะใช้แสดงใน bubble
      const finalText =
        typeof msgObj === "string"
          ? msgObj
          : msgObj?.text ?? JSON.stringify(msgObj);

      // กรณี backend ส่ง taskId ใหม่กลับมา
      if (msgObj?.taskId && msgObj.taskId !== currentTaskIdRef.current) {
        setCurrentTaskId(msgObj.taskId);
        upgradePendingBubble(msgObj.taskId);
      }

      const tId = msgObj?.taskId || currentTaskIdRef.current;

      setMessages((prev) => {
        const pendId = tId ? pendingBubbleId(tId) : "pending-generic";

        // หา index ของ bubble pending ที่จะถูกแทนที่
        let idx = prev.findIndex((m) => m.id === pendId);
        if (idx < 0) idx = prev.findIndex((m) => m.pending === true);

        const newMsg = {
          id: Date.now().toString(),
          from: "bot",
          text: finalText,
          time: formatTS(Date.now()),
        };

        let next;
        if (idx >= 0) {
          // แทนที่ bubble pending ด้วยข้อความจริง
          next = [...prev];
          next.splice(idx, 1, newMsg);
        } else {
          // ถ้าไม่เจอ pending เลยก็ใส่ต่อท้าย
          next = [...prev, newMsg];
        }

        // ปลดสถานะ pendingClient ของข้อความฝั่ง user
        next = next.map((m) =>
          m.id === pendingUserMsgId && m.from === "user"
            ? { ...m, pendingClient: false }
            : m
        );

        return next;
      });

      // reset state การรอ (sending/pending ทั้งหมด)
      hardResetPendingState();

      const chatId2 = selectedChatIdRef.current;
      if (chatId2) {
        storage.setItem(
          STORAGE_PREFIX + String(chatId2),
          JSON.stringify({ sending: false, savedAt: Date.now() })
        );
      }
    };

    const unsubscribe = subscribeTask(taskId, handler);
    return () => unsubscribe?.();
  }, [subscribeTask, currentTaskId]);

  /* =============== Polling (fallback heartbeat & status) =============== */

  const pollTimerRef = useRef(null);
  const heartbeatRef = useRef(null);
  const unmountedRef = useRef(false);

  // cleanup timer เมื่อ component ถูก unmount
  useEffect(
    () => () => {
      unmountedRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    },
    []
  );

  // หยุดทั้ง poll checkStatus และ heartbeat
  const stopPendingPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  // heartbeat: ทุก 10 วิ ไปอัปเดต savedAt ใน storage ว่ายัง active อยู่
  const startHeartbeat = (chatId) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      if (!chatId) return;
      const raw = await storage.getItem(STORAGE_PREFIX + String(chatId));
      const s = raw ? JSON.parse(raw) : {};
      await storage.setItem(
        STORAGE_PREFIX + String(chatId),
        JSON.stringify({ ...s, savedAt: Date.now() })
      );
    }, 10_000);
  };

  // เริ่มต้นกระบวนการ polling สถานะของ task
  const startPendingPoll = ({
    chatId,
    taskId,
    pendingQnaId,
    pendingUserMsgId,
    pendingUserMsg,
    initialDelay = 1200,
  }) => {
    stopPendingPoll();
    startHeartbeat(chatId);

    // แสดง bubble error กรณีมีปัญหา
    const postErrorBubble = (text) => {
      const now = Date.now();
      setMessages((prev) => [
        ...prev.filter((m) => !(m.pending === true && m.from === "bot")),
        {
          id: String(now),
          from: "bot",
          text,
          time: formatTS(now),
        },
      ]);
    };

    // จัดการทั้งฝั่ง UI + storage เมื่อ task ล้มเหลว + cancel
    const handleFailureAndCancel = async (
      userMsgIdToClear,
      errTextForUser
    ) => {
      try {
        // พยายาม save คำตอบ error กลับไป backend
        try {
          await saveAnswer({
            taskId,
            chatId,
            qNaWords: errTextForUser,
          });
        } catch (eSave) {
          console.warn("saveAnswer failed:", eSave?.message || eSave);
        }

        removePendingBotBubble(taskId);

        if (userMsgIdToClear)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === userMsgIdToClear ? { ...m, pendingClient: false } : m
            )
          );

        postErrorBubble(errTextForUser);

        await storage.setItem(
          STORAGE_PREFIX + String(chatId),
          JSON.stringify({
            sending: false,
            savedAt: Date.now(),
            cancelledAt: Date.now(),
          })
        );
      } finally {
        hardResetPendingState({ keepCancelled: true });
        stopPendingPoll();
      }
    };

    // ฟังก์ชันทำ polling แบบ recursive
    const poll = async (delay) => {
      if (unmountedRef.current) return;

      pollTimerRef.current = setTimeout(async () => {
        try {
          const st = await checkStatus(taskId);

          const rawErrMsg =
            st?.error || st?.responseData?.error || st?.data?.error || "";
          if (rawErrMsg) {
            const msg = String(rawErrMsg || "");

            if (/task\s+not\s+found/i.test(msg) || /not\s+found/i.test(msg)) {
              notify(
                "เกิดข้อผิดพลาด",
                "ระบบจะยกเลิกคำขอนี้ให้อัตโนมัติ"
              );
              await handleFailureAndCancel(
                pendingUserMsgId,
                "เกิดข้อผิดพลาดในการประมวลผลจากเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง"
              );
              return;
            }

            notify(
              "งานล้มเหลว",
              msg.split("\n").slice(0, 8).join("\n") ||
                "เกิดข้อผิดพลาดในการประมวลผล"
            );
            await handleFailureAndCancel(
              pendingUserMsgId,
              "เกิดข้อผิดพลาดในการประมวลผลจากเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง"
            );
            return;
          }

          const state =
            st?.state || st?.responseData?.state || st?.data?.state || null;
          const status =
            st?.status || st?.responseData?.status || st?.data?.status || null;

          const isRunning =
            ["running", "queued"].includes(state) ||
            ["running", "queued"].includes(status);
          const isError =
            ["error", "failed"].includes(state) ||
            ["error", "failed"].includes(status);
          const isDone = state === "done" || status === "done";

          if (isRunning) {
            const nextDelay = Math.min(
              3000,
              Math.max(1000, Math.floor(delay * 1.2))
            );
            await storage.setItem(
              STORAGE_PREFIX + String(chatId),
              JSON.stringify({
                sending: true,
                currentTaskId: taskId,
                pendingQnaId,
                pendingUserMsgId,
                pendingUserMsg,
                pendingUserMsgTs: Date.now(),
                savedAt: Date.now(),
              })
            );
            upgradePendingBubble(taskId);
            poll(nextDelay);
            return;
          }

          if (isError) {
            notify("งานล้มเหลว", "เกิดข้อผิดพลาดในการประมวลผล");
            await handleFailureAndCancel(
              pendingUserMsgId,
              "เกิดข้อผิดพลาดในการประมวลผลจากเซิร์ฟเวอร์"
            );
            return;
          }

          if (isDone) {
            await storage.setItem(
              STORAGE_PREFIX + String(chatId),
              JSON.stringify({ sending: false, savedAt: Date.now() })
            );
            stopPendingPoll();
            return;
          }

          // กรณียังไม่ชัดเจน → เพิ่ม delay ทีละนิด
          poll(Math.min(4000, delay + 500));
        } catch (e) {
          console.warn("poll checkStatus error:", e?.message || e);
          poll(Math.min(5000, delay * 1.5));
        }
      }, delay);
    };

    // เริ่มทำ polling รอบแรก
    poll(initialDelay);
  };

  /* =============== Load chats & history =============== */

  // ensure ว่าต้องมีห้อง active สำหรับ user (ใช้ตอนจะส่งคำถาม)
  const ensureActiveChat = async () => {
    if (!user) return { id: null, created: false };

    const currentId = selectedChatIdRef.current;

    // ถ้ามีห้องและยังอยู่ใน list → ใช้ห้องเดิม
    if (
      currentId &&
      chats.some((c) => String(c.id) === String(currentId))
    ) {
      return { id: currentId, created: false };
    }

    // ถ้ามี list ห้องแต่ยังไม่ได้เลือก → เลือกห้องแรก
    if (chats.length > 0) {
      const id = String(chats[0].id);
      setSelectedChatId(id);
      return { id, created: false };
    }

    // ไม่มีห้องเลย → สร้างห้องใหม่
    try {
      const created = await createChat({
        userId: user?.id || user?._id,
        chatHeader: "แชตใหม่",
      });
      const newChatId = String(created?.chatId ?? created?.id);
      const item = {
        id: newChatId,
        title: created?.chatHeader || "แชตใหม่",
      };
      setChats([item]);
      setSelectedChatId(newChatId);
      return { id: newChatId, created: true };
    } catch (e) {
      console.error("ensureActiveChat create error:", e);
      notify("ผิดพลาด", "ไม่สามารถสร้างแชตใหม่ได้");
      return { id: null, created: false };
    }
  };

  // เปิด popup menu ของห้อง (สามจุด) พร้อมตำแหน่ง
  const openItemMenu = (id, x, y) => {
    setMenuFor(id);
    setMenuPos({ x, y });
  };

  const closeItemMenu = () => setMenuFor(null);

  // คำนวณ style ของ popup menu ให้ไม่ล้นหน้าจอ
  const getPopupStyle = () => {
    const { width, height } = Dimensions.get("window");
    const MW = 200;
    const MH = 160;
    const PAD = 10;

    return {
      left: Math.min(menuPos.x, width - MW - PAD),
      top: Math.min(menuPos.y, height - MH - PAD),
      width: MW,
    };
  };

  // toggle เปิดปิด sidebar (slide จากซ้าย)
  const toggleSidebar = () => {
    const toOpen = !sidebarOpen;
    Animated.timing(sidebarAnim, {
      toValue: toOpen ? 0 : -260,
      duration: 260,
      useNativeDriver: false,
    }).start(() => setSidebarOpen(toOpen));
  };

  // โหลดรายชื่อห้องของ user จาก backend
  const loadUserChats = async () => {
    if (!user?.id && !user?._id) return;
    setLoadingChats(true);

    const lastSelectedId = await storage.getItem(LAST_CHAT_ID_KEY);

    try {
      const list = await getUserChats(user.id || user._id);
      const mapped = (list || []).map((c) => ({
        id: String(c.chatId ?? c.id),
        title: c.chatHeader || "แชต",
      }));
      setChats(mapped);

      if (mapped.length === 0) {
        // ไม่มีห้องเลย → สร้างห้องใหม่ให้ทันที
        const created = await createChat({
          userId: user.id || user._id,
          chatHeader: "แชตใหม่",
        });
        const newChatId = String(created?.chatId ?? created?.id);
        setChats([
          {
            id: newChatId,
            title: created?.chatHeader || "แชตใหม่",
          },
        ]);
        setSelectedChatId(newChatId);
      } else {
        // ถ้าใน storage เคยจำว่าห้องไหนถูกเลือก → พยายามเลือกห้องนั้นต่อ
        const lastIsValid =
          !!lastSelectedId &&
          mapped.some((c) => String(c.id) === String(lastSelectedId));

        setSelectedChatId(
          lastIsValid ? String(lastSelectedId) : String(mapped[0].id)
        );
      }
    } catch (err) {
      console.error("loadUserChats error:", err);
      notify("ผิดพลาด", "ไม่สามารถโหลดรายชื่อแชตได้");
    } finally {
      setLoadingChats(false);
    }
  };
    // โหลดประวัติข้อความของห้องตาม chatId
  const loadHistory = async (chatId) => {
    if (!chatId) return;

    setLoadingHistory(true);
    // ชั่วคราว: หยุดระบบ persist state เพื่อไม่ให้ชนกับการ setMessages ตอนโหลด
    persistSuspendedRef.current = true;

    // reset state การรอทั้งหมดก่อนโหลดห้องใหม่
    setSending(false);
    setShowStop(false);
    setCurrentTaskId(null);
    setPendingQnaId(null);
    setPendingUserMsgId(null);
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);

    try {
      const rows = await getChatQna(chatId);

      // เรียงตามเวลาเก่า → ใหม่
      const sorted = (rows || [])
        .slice()
        .sort(
          (a, b) =>
            toTS(a?.createdAt || a?.createAt) -
            toTS(b?.createdAt || b?.createAt)
        );

      // map เป็น message สำหรับ UI
      const historyMsgs = sorted.map((r, idx) => {
        const tsNum = toTS(r?.createdAt || r?.createAt || Date.now());
        return {
          id: String(r?.qNaId || idx),
          from: r?.qNaType === "Q" ? "user" : "bot",
          text: toDisplayQuestionOnly(r?.qNaWords),
          time: formatTS(tsNum),
          tsNum,
        };
      });

      let nextMsgs = historyMsgs.slice();

      // โหลด state ที่เคยเซฟไว้ของห้องนี้ (เช่น pending อยู่ไหม ฯลฯ)
      const rawSaved = await storage.getItem(
        STORAGE_PREFIX + String(chatId)
      );

      if (rawSaved) {
        const saved = JSON.parse(rawSaved || {});

        // กรณีเคย cancel ไปแล้ว
        if (saved?.cancelledAt) {
          await storage.setItem(
            STORAGE_PREFIX + String(chatId),
            JSON.stringify({ sending: false, savedAt: Date.now() })
          );
          setSending(false);
          setShowStop(false);
          setCurrentTaskId(null);
          setPendingQnaId(null);
          setPendingUserMsgId(null);

          // ลบทุก message ที่เป็น pending ออก
          nextMsgs = nextMsgs.filter(
            (m) =>
              !(
                m.pending === true ||
                (m.from === "user" && m.pendingClient)
              )
          );
          setMessages(nextMsgs);
          shouldScrollRef.current = true;

          setLoadingHistory(false);
          persistSuspendedRef.current = false;
          return;
        }

        // ถ้ามีสถานะว่าเคยกำลังส่งอยู่
        if (saved?.sending) {
          const TTL_MS = 30 * 1000; // อายุ cache 30 วินาที

          // ถ้า savedAt เกิน TTL → ถือว่าหมดอายุ ล้างสถานะรอ
          if (!saved.savedAt || Date.now() - saved.savedAt > TTL_MS) {
            await storage.setItem(
              STORAGE_PREFIX + String(chatId),
              JSON.stringify({ sending: false, savedAt: Date.now() })
            );
            setSending(false);
            setShowStop(false);
            setCurrentTaskId(null);
            setPendingQnaId(null);
            setPendingUserMsgId(null);
            removePendingBotBubble(null);
            setMessages((prev) =>
              prev.filter(
                (m) =>
                  !(
                    m.pending === true ||
                    (m.from === "user" && m.pendingClient)
                  )
              )
            );
          } else {
            // ยังไม่หมดอายุ → พยายาม restore สถานะ pending เดิม
            const savedPendingMsg = saved.pendingUserMsg || null;
            const savedPendingTs =
              toTS(savedPendingMsg?.time) ||
              toTS(saved.pendingUserMsgTs) ||
              toTS(saved.savedAt);

            const TEXT_NORM = (s) => (s || "").trim();

            // เช็คว่ามี user Q ตัวเดียวกับที่ pending ในประวัติที่โหลดมาหรือยัง
            const hasSameUserQRecorded =
              !!savedPendingMsg &&
              historyMsgs.some(
                (m) =>
                  m.from === "user" &&
                  TEXT_NORM(m.text) === TEXT_NORM(savedPendingMsg.text)
              );

            // มีข้อความฝั่งบอทหลังจากเวลาที่ pending หรือไม่
            const hasBotAfterPending = historyMsgs.some(
              (m) =>
                m.from === "bot" &&
                (m.tsNum || 0) >= (savedPendingTs || 0)
            );

            // ตั้งค่าสถานะว่ากำลังส่ง + เตรียมแสดงปุ่ม stop
            setSending(true);
            setShowStop(false);
            if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
            stopTimerRef.current = setTimeout(
              () => setShowStop(true),
              450
            );

            if (hasBotAfterPending) {
              // ถ้ามีคำตอบจากบอทตามหลังแล้ว แสดงว่า task น่าจะเสร็จ → ล้าง sending
              await storage.setItem(
                STORAGE_PREFIX + String(chatId),
                JSON.stringify({ sending: false, savedAt: Date.now() })
              );
              setSending(false);
              setShowStop(false);
              setCurrentTaskId(null);
              setPendingQnaId(null);
              setPendingUserMsgId(null);
            } else {
              const taskId = saved.currentTaskId || null;
              const qId = saved.pendingQnaId || null;

              // ถ้ายังไม่มี bubble pending ใน nextMsgs → เพิ่ม "pending-generic"
              if (!nextMsgs.some((m) => m.pending === true)) {
                nextMsgs.push({
                  id: "pending-generic",
                  from: "bot",
                  pending: true,
                  text: "กำลังประมวลผล...",
                  time: formatTS(Date.now()),
                  tsNum: Date.now(),
                  pendingClient: true,
                });
              }

              if (taskId) {
                // มี taskId เดิมอยู่ → พยายามผูก pending กับข้อความ user และ task นี้
                const hasSameUserQInNext =
                  !!savedPendingMsg &&
                  nextMsgs.some(
                    (m) =>
                      m.from === "user" &&
                      TEXT_NORM(m.text) ===
                        TEXT_NORM(savedPendingMsg.text)
                  );

                if (savedPendingMsg && !hasSameUserQInNext) {
                  // ถ้าใน nextMsgs ยังไม่มี user msg ตัวนี้ → push เพิ่ม
                  nextMsgs.push({
                    id: savedPendingMsg.id,
                    from: "user",
                    text: toDisplayQuestionOnly(savedPendingMsg.text),
                    time: savedPendingMsg.time,
                    tsNum: toTS(savedPendingMsg.time) || Date.now(),
                    pendingClient: true,
                  });
                } else if (savedPendingMsg && hasSameUserQInNext) {
                  // ถ้ามีแล้ว → mark pendingClient = true ให้ message นั้น
                  const idx = nextMsgs.findIndex(
                    (m) =>
                      m.from === "user" &&
                      TEXT_NORM(m.text) ===
                        TEXT_NORM(savedPendingMsg.text)
                  );
                  if (idx >= 0) {
                    nextMsgs[idx] = {
                      ...nextMsgs[idx],
                      pendingClient: true,
                    };
                    setPendingUserMsgId(nextMsgs[idx].id);
                  }
                }

                // เปลี่ยน bubble "pending-generic" ให้ผูกกับ taskId
                const pendId = "pending-" + String(taskId);
                if (!nextMsgs.some((m) => m.id === pendId)) {
                  const genIdx = nextMsgs.findIndex(
                    (m) => m.id === "pending-generic"
                  );
                  if (genIdx >= 0) nextMsgs.splice(genIdx, 1);
                  nextMsgs.push({
                    id: pendId,
                    from: "bot",
                    pending: true,
                    text: "กำลังประมวลผล...",
                    time: formatTS(Date.now()),
                    tsNum: Date.now(),
                  });
                }

                setCurrentTaskId(taskId);
                setPendingQnaId(qId || null);

                const recordedIdx = savedPendingMsg
                  ? nextMsgs.findIndex(
                      (m) =>
                        m.from === "user" &&
                        TEXT_NORM(m.text) ===
                          TEXT_NORM(savedPendingMsg.text)
                    )
                  : -1;

                setPendingUserMsgId(
                  recordedIdx >= 0
                    ? nextMsgs[recordedIdx].id
                    : saved?.pendingUserMsgId ||
                        savedPendingMsg?.id ||
                        null
                );

                await storage.setItem(
                  STORAGE_PREFIX + String(chatId),
                  JSON.stringify({
                    sending: true,
                    currentTaskId: taskId,
                    pendingQnaId: qId || null,
                    pendingUserMsgId:
                      recordedIdx >= 0
                        ? nextMsgs[recordedIdx].id
                        : saved?.pendingUserMsgId ||
                          savedPendingMsg?.id ||
                          null,
                    pendingUserMsg: savedPendingMsg || null,
                    pendingUserMsgTs: savedPendingTs || Date.now(),
                    savedAt: Date.now(),
                  })
                );

                // เริ่ม polling สถานะ task นี้
                startPendingPoll({
                  chatId,
                  taskId,
                  pendingQnaId: qId || null,
                  pendingUserMsgId: saved.pendingUserMsgId || null,
                  pendingUserMsg: savedPendingMsg || null,
                });
              } else {
                // ไม่มี taskId แต่มี pendingMsg → อาจหลุด mid-flight → re-ask ใหม่
                if (
                  savedPendingMsg &&
                  !hasBotAfterPending &&
                  !hasSameUserQRecorded
                ) {
                  try {
                    // ถ้ายังไม่มี message ตัวนี้ใน nextMsgs ให้ push ก่อน
                    if (
                      !nextMsgs.some(
                        (m) => m.id === saved.pendingUserMsgId
                      )
                    ) {
                      nextMsgs.push({
                        id: savedPendingMsg.id,
                        from: "user",
                        text: toDisplayQuestionOnly(
                          savedPendingMsg.text
                        ),
                        time:
                          savedPendingMsg.time ||
                          formatTS(savedPendingTs || Date.now()),
                        tsNum: savedPendingTs || Date.now(),
                        pendingClient: true,
                      });
                    } else {
                      const idx = nextMsgs.findIndex(
                        (m) =>
                          m.from === "user" &&
                          TEXT_NORM(m.text) ===
                            TEXT_NORM(savedPendingMsg.text)
                      );
                      if (idx >= 0) {
                        nextMsgs[idx] = {
                          ...nextMsgs[idx],
                          pendingClient: true,
                        };
                        setPendingUserMsgId(nextMsgs[idx].id);
                      }
                    }

                    // เรียก askQuestion ใหม่ใช้ข้อความที่ตัดเนื้อหาไฟล์แล้ว
                    const resp2 = await askQuestion({
                      chatId,
                      question: toDisplayQuestionOnly(
                        savedPendingMsg.text
                      ),
                    });

                    const newTaskId =
                      resp2?.taskId ||
                      resp2?.id ||
                      resp2?.data?.taskId ||
                      resp2?.data?.id ||
                      null;

                    const newQId =
                      resp2?.qNaId ||
                      resp2?.data?.qNaId ||
                      resp2?.data?.savedRecordQuestion?.qNaId ||
                      resp2?.savedRecordQuestion?.qNaId ||
                      resp2?.questionRecord?.qNaId ||
                      null;

                    setCurrentTaskId(newTaskId);
                    setPendingQnaId(newQId);

                    const genIdx = nextMsgs.findIndex(
                      (m) => m.id === "pending-generic"
                    );
                    if (newTaskId && genIdx >= 0)
                      nextMsgs.splice(genIdx, 1);

                    if (newTaskId) {
                      nextMsgs.push({
                        id: `pending-${newTaskId}`,
                        from: "bot",
                        pending: true,
                        text: "กำลังประมวลผล...",
                        time: formatTS(Date.now()),
                        tsNum: Date.now(),
                      });
                    }

                    const recordedIdx = savedPendingMsg
                      ? nextMsgs.findIndex(
                          (m) =>
                            m.from === "user" &&
                            TEXT_NORM(m.text) ===
                              TEXT_NORM(savedPendingMsg.text)
                        )
                      : -1;

                    await storage.setItem(
                      STORAGE_PREFIX + String(chatId),
                      JSON.stringify({
                        sending: true,
                        currentTaskId: newTaskId,
                        pendingQnaId: newQId,
                        pendingUserMsgId:
                          recordedIdx >= 0
                            ? nextMsgs[recordedIdx].id
                            : saved?.pendingUserMsgId ||
                              savedPendingMsg?.id,
                        pendingUserMsg: savedPendingMsg,
                        pendingUserMsgTs: savedPendingTs,
                        savedAt: Date.now(),
                      })
                    );

                    if (newTaskId) {
                      startPendingPoll({
                        chatId,
                        taskId: newTaskId,
                        pendingQnaId: newQId || null,
                        pendingUserMsgId:
                          saved.pendingUserMsgId || null,
                        pendingUserMsg: savedPendingMsg || null,
                      });
                    }
                  } catch (eReask) {
                    console.warn(
                      "Re-ask failed:",
                      eReask?.message || eReask
                    );
                  }
                } else {
                  // ถ้าไม่มีอะไรต้องรอต่อ → ล้าง sending
                  await storage.setItem(
                    STORAGE_PREFIX + String(chatId),
                    JSON.stringify({
                      sending: false,
                      savedAt: Date.now(),
                    })
                  );
                  setSending(false);
                  setShowStop(false);
                  setCurrentTaskId(null);
                  setPendingQnaId(null);
                  setPendingUserMsgId(null);
                }
              }
            }
          }
        }
      }

      // เรียงตาม tsNum อีกรอบเพื่อความชัวร์
      nextMsgs.sort((a, b) => (a.tsNum || 0) - (b.tsNum || 0));
      setMessages(nextMsgs);
      shouldScrollRef.current = true;
    } catch (err) {
      console.error("loadHistory error:", err);
      notify("ผิดพลาด", "ไม่สามารถโหลดประวัติแชตได้");
      setMessages([]);
      shouldScrollRef.current = true;
    } finally {
      setLoadingHistory(false);
      persistSuspendedRef.current = false;
    }
  };

  // จำ id ห้องล่าสุดไว้ใน storage ทุกครั้งที่เปลี่ยนห้อง
  useEffect(() => {
    if (selectedChatId)
      storage.setItem(LAST_CHAT_ID_KEY, String(selectedChatId));
  }, [selectedChatId]);

  // ทุกครั้งที่ user login/logout → โหลดรายชื่อห้องใหม่ หรือเคลียร์ทั้งหมด
  useEffect(() => {
    if (!user) {
      setChats([]);
      setSelectedChatId(null);
      setMessages([]);
      return;
    }
    loadUserChats();
  }, [user]);

  // ทุกครั้งที่ selectedChatId เปลี่ยน → โหลดประวัติห้องนั้น
  useEffect(() => {
    if (selectedChatId) loadHistory(selectedChatId);
  }, [selectedChatId]);
    /* =============== Persist session state of pending task =============== */
  useEffect(() => {
    (async () => {
      if (!selectedChatId || persistSuspendedRef.current) return;

      const data = {
        sending,
        currentTaskId,
        pendingQnaId,
        pendingUserMsgId,
        // เก็บทั้ง object ของ message ฝั่ง user ที่กำลัง pending อยู่
        pendingUserMsg:
          pendingUserMsgId &&
          messages.find(
            (m) => m.id === pendingUserMsgId && m.from === "user"
          ),
        pendingUserMsgTs: Date.now(),
        savedAt: Date.now(),
      };

      await storage.setItem(
        STORAGE_PREFIX + String(selectedChatId),
        JSON.stringify(data)
      );
    })();
  }, [sending, currentTaskId, pendingQnaId, pendingUserMsgId, selectedChatId, messages]);

  /* =============== Clear expired pending when refocused =============== */
  // เวลา navigate กลับมาหน้านี้ (focus) → เช็คว่า pending เดิมหมดอายุหรือ cancel ไปแล้วหรือยัง
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const chatId = selectedChatIdRef.current;
        if (!chatId) return;

        const raw = await storage.getItem(
          STORAGE_PREFIX + String(chatId)
        );
        if (!raw) return;

        const saved = JSON.parse(raw);

        // ถ้าเคย set cancelledAt ไว้ → ล้างทุกอย่าง + ลบ bubble pending
        if (saved?.cancelledAt) {
          await storage.setItem(
            STORAGE_PREFIX + String(chatId),
            JSON.stringify({ sending: false, savedAt: Date.now() })
          );
          setSending(false);
          setShowStop(false);
          setCurrentTaskId(null);
          setPendingQnaId(null);
          setPendingUserMsgId(null);
          removePendingBotBubble(null);
          setMessages((prev) =>
            prev.filter(
              (m) =>
                !(
                  m.pending === true ||
                  (m.from === "user" && m.pendingClient)
                )
            )
          );
          return;
        }

        // ถ้ายังติดสถานะ sending อยู่ → เช็ค TTL ถ้าเกินเวลาให้ล้างเหมือนกัน
        if (saved?.sending) {
          const TTL_MS = 30 * 1000;
          if (!saved.savedAt || Date.now() - saved.savedAt > TTL_MS) {
            await storage.setItem(
              STORAGE_PREFIX + String(chatId),
              JSON.stringify({ sending: false, savedAt: Date.now() })
            );
            setSending(false);
            setShowStop(false);
            setCurrentTaskId(null);
            setPendingQnaId(null);
            setPendingUserMsgId(null);
            removePendingBotBubble(null);
            setMessages((prev) =>
              prev.filter(
                (m) =>
                  !(
                    m.pending === true ||
                    (m.from === "user" && m.pendingClient)
                  )
              )
            );
          }
        }
      })();
    }, [])
  );

  /* =============== Guest cancel on tab close (web only) =============== */
  useEffect(() => {
    // ใช้เฉพาะบนเว็บ และเฉพาะ guest (ไม่มี user.id)
    if (Platform.OS !== "web") return;
    if (user?.id || user?._id) return;

    const qnaBase = `${EXPO_PUBLIC_API_URL}/qNa`;

    // สร้าง URL สำหรับเรียก cancel งาน
    const buildCancelUrl = (taskId, qnaId) => {
      const url = new URL(
        `${qnaBase}/cancel/${encodeURIComponent(taskId)}`
      );
      url.searchParams.set("guest", "1");
      if (qnaId) url.searchParams.set("qNaId", String(qnaId));
      return url.toString();
    };

    // พยายามส่ง cancel แบบ background (sendBeacon) ถ้าไม่ได้ค่อย fallback ใช้ fetch
    const sendGuestCancel = (taskId, qnaId) => {
      if (!taskId) return false;
      const url = buildCancelUrl(taskId, qnaId);

      try {
        const ok = navigator.sendBeacon(
          url,
          new Blob([], { type: "text/plain" })
        );
        if (ok) return true;
      } catch {}

      try {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guest: 1, qNaId: qnaId ?? null }),
          keepalive: true,
          credentials: "omit",
          cache: "no-store",
          mode: "cors",
        }).catch(() => {});
        return true;
      } catch {}

      return false;
    };

    let fired = false;

    // ให้ยิง cancel แค่ครั้งเดียวตอน tab กำลังปิด
    const fireOnce = () => {
      if (fired) return;
      const taskId = currentTaskIdRef.current;
      if (!taskId) return;
      fired = true;
      sendGuestCancel(taskId, pendingQnaId || null);
    };

    const onBeforeUnload = () => fireOnce();
    const onUnload = () => fireOnce();

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("unload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("unload", onUnload);
    };
  }, [pendingQnaId, currentTaskId, user]);
                /* =============== Chat room ops =============== */
  const addNewChat = async () => {
    if (!user)
      return notify(
        "โหมดไม่บันทึก",
        "กรุณาเข้าสู่ระบบเพื่อสร้างห้องแชตและบันทึกประวัติ"
      );
    try {
      const created = await createChat({
        userId: user?.id || user?._id,
        chatHeader: "แชตใหม่",
      });
      const newChatId = String(created?.chatId ?? created?.id);
      const item = {
        id: newChatId,
        title: created?.chatHeader || "แชตใหม่",
      };
      setChats((prev) => [item, ...prev]);
      setSelectedChatId(newChatId);
      setMessages([]);
    } catch (err) {
      console.error("createChat error:", err);
      notify("ผิดพลาด", "ไม่สามารถสร้างแชตใหม่ได้");
    }
  };

  // ยืนยันก่อนลบ (บน web ใช้ window.confirm, mobile ตอนนี้คืน false = ยังไม่ลบ)
  const confirmDelete = () =>
    Platform.OS === "web"
      ? Promise.resolve(window.confirm("ต้องการลบแชตนี้หรือไม่?"))
      : Promise.resolve(false);

  // จัดการ logout
  const handleLogout = async () => {
    try {
      await logout();
      if (Platform.OS === "web") window.location.reload();
      else {
        setChats([]);
        setSelectedChatId(null);
        setMessages([]);
        navigation.reset({
          index: 0,
          routes: [{ name: "Login" }],
        });
      }
    } catch (e) {
      console.error("logout error:", e);
    }
  };

  // ลบห้องแชทตาม id
  const deleteChat = async (id) => {
    const ok = await confirmDelete();
    if (!ok) return;

    try {
      await apiDeleteChat(id);

      setChats((prev) =>
        prev.filter((c) => String(c.id) !== String(id))
      );

      if (String(selectedChatId) === String(id)) {
        if (chats.length > 1) {
          const next = chats.find(
            (c) => String(c.id) !== String(id)
          );
          setSelectedChatId(next ? String(next.id) : null);
        } else {
          setSelectedChatId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error("deleteChat error:", err);
      notify("ผิดพลาด", "ลบแชตไม่สำเร็จ");
    }
  };

  // เริ่ม rename inline: เซ็ต editingId + ข้อความเดิม
  const startRenameInline = (id) => {
    const current = chats.find((c) => String(c.id) === String(id));
    setEditingId(String(id));
    setEditingText(current?.title || "");
    closeItemMenu();
  };

  // ยกเลิก rename inline
  const cancelRenameInline = () => {
    setEditingId(null);
    setEditingText("");
  };

  // ยืนยัน rename inline → call API แล้วอัปเดต state
  const confirmRenameInline = async () => {
    const id = editingId;
    const title = (editingText || "").trim();
    if (!id) return;
    if (!title) return notify("กรุณาระบุชื่อแชต");

    try {
      await apiEditChat(id, { chatHeader: title });
      setChats((prev) =>
        prev.map((c) =>
          String(c.id) === String(id) ? { ...c, title } : c
        )
      );
      setEditingId(null);
      setEditingText("");
    } catch (e) {
      console.error("rename chat error:", e);
      notify("ผิดพลาด", "แก้ไขชื่อแชตไม่สำเร็จ");
    }
  };
    /* =============== Send / Cancel =============== */

  // ป้องกันการกดส่งรัว ๆ (ใช้ ref แทน state เพื่อไม่ให้ re-render)
  const firingRef = useRef(false);

  const triggerSend = async () => {
    if (firingRef.current || sending) return; // กำลังส่งอยู่แล้ว → ไม่ทำซ้ำ
    firingRef.current = true;
    try {
      await sendMessage();
    } finally {
      firingRef.current = false;
    }
  };

  // ฟังก์ชันหลักที่ใช้ตอนกดส่งข้อความ
  const sendMessage = async () => {
    const rawText = (inputText || "").trim();
    const attachTextTrim = (attachment?.text ?? "").trim();

    const hasText = rawText.length > 0;
    const hasAttach = attachTextTrim.length > 0;

    // มี attachment แต่เนื้อหาไฟล์ว่าง
    if (attachment && !hasAttach) {
      notify("ไฟล์ว่าง", "ไฟล์ที่แนบไม่มีเนื้อหา กรุณาเลือกไฟล์ใหม่");
      setAttachment(null);
      return;
    }

    // ไม่มีทั้งข้อความและไฟล์
    if (!hasText && !hasAttach)
      return notify("แจ้งเตือน", "กรุณาพิมพ์ข้อความหรือแนบไฟล์ก่อนส่ง");

    // ข้อความที่จะโชว์ใน UI (ตัดเนื้อหาไฟล์ออก เหลือแค่ “(ไฟล์แนบ: xxx)”)
    const uiMessage =
      hasText && hasAttach
        ? `${rawText}\n\n(ไฟล์แนบ: ${attachment.name})`
        : hasText
        ? rawText
        : `(ไฟล์แนบ: ${attachment.name})`;

    // ข้อความเต็มที่ส่งให้ backend (รวมเนื้อหาไฟล์)
    const fullQuestion = buildFullQuestion(
      rawText,
      attachment?.name,
      attachTextTrim
    );

    // hint สำหรับ backend ว่ามีไฟล์อะไร แนบ text เต็มไว้ใช้บันทึก
    const dbSaveHint = hasAttach
      ? { fileName: attachment.name, fileText: attachTextTrim }
      : undefined;

    // ประเมินขนาด body ก่อนส่ง
    const projectedBytes = estimatePayloadBytes({
      chatId: user ? selectedChatIdRef.current : undefined,
      question: fullQuestion,
      ...(dbSaveHint ? { dbSaveHint } : {}),
    });

    if (projectedBytes > FRONTEND_BODY_LIMIT_BYTES) {
      const mb = (projectedBytes / 1024 / 1024).toFixed(2);
      const mbLimit = (
        FRONTEND_BODY_LIMIT_BYTES /
        1024 /
        1024
      ).toFixed(2);
      notify(
        "ข้อความรวมใหญ่เกินไป",
        `ประมาณ ${mb}MB > ${mbLimit}MB — ลดขนาดข้อความหรือไฟล์ก่อนส่ง`
      );
      setAttachment(null);
      return;
    }

    let chatIdToUse = null;
    let createdNewRoom = false;

    // ถ้ามี user → ต้อง ensure ว่ามีห้อง active ให้ใช้
    if (user) {
      const res = await ensureActiveChat();
      chatIdToUse = res?.id ? String(res.id) : null;
      createdNewRoom = !!res?.created;

      if (!chatIdToUse) {
        setMessages((prev) => [
          ...prev,
          {
            id: String(Date.now() + 1),
            from: "bot",
            text: "ไม่สามารถเตรียมห้องแชตได้ กรุณาลองอีกครั้ง",
            time: formatTS(Date.now()),
          },
        ]);
        return;
      }
    }

    const now = Date.now();

    // message ฝั่ง user ที่จะแสดงทันทีใน UI
    const userMsg = {
      id: String(now),
      from: "user",
      text: uiMessage,
      time: formatTS(now),
      pendingClient: true, // mark ว่ากำลังรอคำตอบ (ใช้ปิด spinner client)
    };

    // เคลียร์ input
    setInputText("");

    // บน web: reset ความสูง textarea
    if (Platform.OS === "web") {
      const el = webRef.current;
      if (el) {
        el.style.height = "";
        setInputHeight(MIN_H);
      }
    }

    // ล้างไฟล์แนบ (เพราะส่งไปแล้ว)
    setAttachment(null);

    // จำ id ของ user message ที่กำลัง pending
    setPendingUserMsgId(userMsg.id);

    // ตั้ง flag ให้ auto scroll ลงล่างเมื่อมีการ render ใหม่
    shouldScrollRef.current = true;

    // เพิ่ม message user เข้า list
    setMessages((prev) => [...prev, userMsg]);

    // ตั้งสถานะว่ากำลังส่ง
    setSending(true);
    setShowStop(false);

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    // หน่วง 450ms ก่อนโชว์ปุ่ม stop เพื่อกันการกะพริบถ้าตอบเร็วมาก
    stopTimerRef.current = setTimeout(() => setShowStop(true), 450);

    // แสดง bubble “กำลังประมวลผล...” ฝั่งบอท
    addPendingBotBubble(null);

    // เซฟ state sending ลง storage
    if (chatIdToUse) {
      storage.setItem(
        STORAGE_PREFIX + String(chatIdToUse),
        JSON.stringify({
          sending: true,
          currentTaskId: null,
          pendingQnaId: null,
          pendingUserMsgId: userMsg.id,
          pendingUserMsg: userMsg,
          pendingUserMsgTs: now,
          savedAt: now,
        })
      );
    }

    // เรียก API askQuestion จริง ๆ
    try {
      const resp = await askQuestion({
        chatId: user ? chatIdToUse : undefined,
        question: fullQuestion,
        dbSaveHint,
      });

      // ดึง taskId / qNaId จาก response ที่กลับมา
      const taskId =
        resp?.taskId || resp?.id || resp?.data?.taskId || resp?.data?.id || null;
      setCurrentTaskId(taskId);

      const qId =
        resp?.qNaId ||
        resp?.data?.qNaId ||
        resp?.data?.savedRecordQuestion?.qNaId ||
        resp?.savedRecordQuestion?.qNaId ||
        resp?.questionRecord?.qNaId ||
        null;

      setPendingQnaId(qId);

      // ถ้าได้ taskId แล้ว → ผูก bubble pending กับ taskId
      if (taskId) upgradePendingBubble(taskId);

      // อัปเดต storage ของห้องนี้ให้รู้ว่ากำลังรอ task ไหน
      if (chatIdToUse) {
        storage.setItem(
          STORAGE_PREFIX + String(chatIdToUse),
          JSON.stringify({
            sending: true,
            currentTaskId: taskId,
            pendingQnaId: qId,
            pendingUserMsgId: userMsg.id,
            pendingUserMsg: userMsg,
            pendingUserMsgTs: now,
            pendingFullQuestion: fullQuestion,
            savedAt: Date.now(),
          })
        );
      }

      // ถ้าเพิ่งสร้างห้องใหม่ → reload history ของห้องนั้น + เพิ่ม pending bubble อีกครั้ง
      if (createdNewRoom && chatIdToUse) {
        await loadHistory(chatIdToUse);
        addPendingBotBubble(taskId || null);
        scrollToBottom(true);
      }
    } catch (error) {
      console.error("askQuestion error:", error);
      // ลบ bubble pending ฝั่งบอท
      removePendingBotBubble(null);
      // แจ้ง error ใน chat
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          from: "bot",
          text: "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์",
          time: formatTS(Date.now()),
        },
      ]);
      // ปลด pendingClient ของ user message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingUserMsgId && m.from === "user"
            ? { ...m, pendingClient: false }
            : m
        )
      );
      // reset pending state ทั้งระบบ
      hardResetPendingState();
    }
  };

  // ฟังก์ชันกดปุ่ม “ยกเลิก” ระหว่างกำลังส่ง
  const cancelSending = async () => {
    try {
      // ถ้ามี currentTaskId → เรียก API cancelAsk
      if (currentTaskId) {
        try {
          await cancelAsk(currentTaskId, {
            qNaId: pendingQnaId || null,
            chatId: selectedChatIdRef.current || null,
          });
        } catch (e) {
          console.warn("cancelAsk error:", e?.message || e);
        }
      }

      // ลบ message ฝั่ง user ที่ยัง pending ออก
      setMessages((prev) => {
        const id = pendingUserMsgId;
        return prev.filter((m) => {
          if (id && m.id === id) return false;
          if (m.from === "user" && m.pendingClient) return false;
          return true;
        });
      });

      // ลบ bubble pending ฝั่งบอท
      if (currentTaskId) removePendingBotBubble(currentTaskId);
      else removePendingBotBubble(null);

      // เซฟสถานะ cancel ลง storage
      const chatId = selectedChatIdRef.current;
      if (chatId) {
        const raw = await storage.getItem(
          STORAGE_PREFIX + String(chatId)
        );
        const old = raw ? JSON.parse(raw) : {};
        await storage.setItem(
          STORAGE_PREFIX + String(chatId),
          JSON.stringify({
            ...old,
            sending: false,
            cancelledAt: Date.now(),
            savedAt: Date.now(),
          })
        );
      }
    } finally {
      // reset state ทั้งหมด (แต่ keepCancelled = true เพื่อให้ logic อื่นรู้ว่ายกเลิกแล้ว)
      hardResetPendingState({ keepCancelled: true, dropUserPending: true });
    }
  };

  // reset สถานะทุกอย่างเกี่ยวกับ pending/sending + จัดการ storage
  const hardResetPendingState = async (opts = {}) => {
    const keepCancelled = !!opts.keepCancelled;
    const dropUserPending = !!opts.dropUserPending;

    setSending(false);
    setShowStop(false);
    setCurrentTaskId(null);
    setPendingQnaId(null);
    setPendingUserMsgId(null);

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);

    // หยุด polling + heartbeat
    stopPendingPoll();

    const chatId = selectedChatIdRef.current;
    if (chatId) {
      const raw = await storage.getItem(
        STORAGE_PREFIX + String(chatId)
      );
      const old = raw ? JSON.parse(raw) : {};
      await storage.setItem(
        STORAGE_PREFIX + String(chatId),
        JSON.stringify({
          ...old,
          sending: false,
          savedAt: Date.now(),
          ...(keepCancelled
            ? { cancelledAt: old?.cancelledAt ?? Date.now() }
            : { cancelledAt: undefined }),
        })
      );
    }

    // ลบ bubble pending ฝั่งบอท + clear pendingClient ของ user
    setMessages((prev) => {
      // ลบทุก message ที่เป็น pending ฝั่ง bot
      let next = prev.filter(
        (m) => !(m.pending === true && m.from === "bot")
      );

      // ถ้า dropUserPending = true → ลบ user ที่ pending ทิ้งเลย
      // ถ้า false → แค่เปลี่ยน pendingClient เป็น false
      next = next
        .map((m) =>
          m.from === "user" && m.pendingClient
            ? dropUserPending
              ? null
              : { ...m, pendingClient: false }
            : m
        )
        .filter(Boolean);

      return next;
    });
  };
           /* =============== Voice =============== */
  const [recording, setRecording] = useState(false);
  const webRecRef = useRef(null);

  // สร้าง SpeechRecognition instance (เฉพาะบน web)
  const getWebRecognizer = () => {
    if (Platform.OS !== "web") return null;
    const SR =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    return SR ? new SR() : null;
  };

  // เริ่มฟังเสียง (web)
  const startVoice = async () => {
    const rec = getWebRecognizer();
    if (!rec)
      return notify(
        "ไม่รองรับ",
        "เบราว์เซอร์นี้ไม่รองรับพิมพ์ด้วยเสียง"
      );

    webRecRef.current = rec;
    rec.lang = "th-TH";
    rec.interimResults = false;
    rec.continuous = false;

    rec.onstart = () => setRecording(true);
    rec.onerror = () => setRecording(false);
    rec.onend = () => setRecording(false);
    rec.onresult = (e) => {
      const txt = e?.results?.[0]?.[0]?.transcript || "";
      if (txt)
        setInputText((prev) => (prev ? prev + " " + txt : txt));
    };

    try {
      rec.start();
    } catch {}
  };

  // หยุดฟังเสียง
  const stopVoice = async () => {
    try {
      webRecRef.current?.stop?.();
    } catch {}
    setRecording(false);
  };

  /* =============== Derived UI flags =============== */

  const hasText = (inputText || "").trim().length > 0;
  const hasAttach =
    !!(attachment && (attachment.text || "").trim().length > 0);
  const canSend = !sending && (hasText || hasAttach);

  // padding bottom ของ FlatList (กันชนกับ input bar + chip attachment)
  const listContentPadBottom = 16 + (attachment ? 56 : 0);

  /* =============== UI =============== */

  return (
    <SafeAreaView
      style={[
        S.container,
        S.containerBg,
        Platform.OS !== "web" ? S.withStatusBarPad : null,
      ]}
    >
      {/* =============== Sidebar =============== */}
      <Animated.View
        style={[
          S.sidebar,
          { left: sidebarAnim },
          S.sidebarBg,
          S.sidebarBorderRight,
        ]}
      >
        <View style={S.sidebarHeader}>
          <Text style={[S.sidebarTitle, S.sidebarTitleColor]}>
            {user
              ? `ประวัติการแชท (${chats.length})`
              : "โหมดไม่บันทึก (Guest)"}
          </Text>

          <View style={S.rowCenter}>
            <TouchableOpacity
              onPress={toggleSidebar}
              style={S.padLeft8}
            >
              <Icon name="close" size={22} color="#333" />
            </TouchableOpacity>
          </View>
        </View>

        {/* รายการห้องแชทฝั่งซ้าย */}
        {user ? (
          loadingChats ? (
            <View style={S.padV10}>
              <ActivityIndicator />
            </View>
          ) : (
            chats.map((chat) => {
              const isEditing =
                String(editingId) === String(chat.id);
              const isActive =
                String(selectedChatId) === String(chat.id);

              return (
                <View
                  key={chat.id}
                  style={[
                    S.sidebarItemRow,
                    S.sidebarItemBorder,
                    isActive
                      ? isDark
                        ? S.sidebarItemActiveDark
                        : S.sidebarItemActiveLight
                      : null,
                    S.sidebarItemRadiusPad,
                  ]}
                >
                  {isEditing ? (
                    // inline rename
                    <View style={S.renameInlineRow}>
                      <TextInput
                        value={editingText}
                        onChangeText={setEditingText}
                        placeholder="ชื่อแชต"
                        placeholderTextColor="#9AA2AF"
                        style={[
                          S.renameInlineInput,
                          S.renameInlineInputTheme,
                        ]}
                        autoFocus
                        returnKeyType="done"
                        blurOnSubmit
                        onSubmitEditing={confirmRenameInline}
                      />
                      <View style={S.renameInlineBtns}>
                        <TouchableOpacity
                          onPress={confirmRenameInline}
                          style={S.inlineIconBtn}
                        >
                          <Icon
                            name="checkmark"
                            size={18}
                            color="#2ecc71"
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={cancelRenameInline}
                          style={S.inlineIconBtn}
                        >
                          <Icon
                            name="close"
                            size={18}
                            color="#e74c3c"
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      {/* กดเลือกห้อง */}
                      <TouchableOpacity
                        style={S.flex1Min0}
                        onPress={() => {
                          setSelectedChatId(String(chat.id));
                          closeItemMenu();
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            S.sidebarItemText,
                            S.sidebarTextColor,
                            isActive ? S.bold700 : null,
                          ]}
                        >
                          {chat.title}
                        </Text>
                      </TouchableOpacity>

                      {/* ปุ่ม … เปิด popup menu (rename / delete) */}
                      <Pressable
                        onPress={(e) =>
                          openItemMenu(
                            chat.id,
                            e?.nativeEvent?.pageX ?? 0,
                            e?.nativeEvent?.pageY ?? 0
                          )
                        }
                        style={S.dotButton}
                        hitSlop={{
                          top: 8,
                          bottom: 8,
                          left: 8,
                          right: 8,
                        }}
                      >
                        <Icon
                          name="ellipsis-vertical"
                          size={18}
                          color="#555"
                        />
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })
          )
        ) : (
          <Text style={S.guestTextInfo}>
            เข้าสู่ระบบเพื่อสร้างห้องและบันทึกประวัติการสนทนา
          </Text>
        )}

        {/* ปุ่มสร้างห้องใหม่ด้านล่าง sidebar */}
        {user && (
          <View style={S.sidebarBottom}>
            <TouchableOpacity
              style={[S.sidebarButton, S.headerBg]}
              onPress={addNewChat}
            >
              <Text style={isDark ? S.whiteText : S.blackText}>
                เพิ่มแชตใหม่
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>

      {/* คลิกตรงหน้ากากเพื่อปิด sidebar */}
      {sidebarOpen && (
        <TouchableOpacity
          style={[S.backdrop, S.overlay]}
          activeOpacity={1}
          onPress={toggleSidebar}
        />
      )}

      {/* =============== Header =============== */}
      <View style={[S.header, S.headerBg]}>
        {/* ด้านซ้าย: เมนู + โลโก้ */}
        <View style={S.headerSideLeft}>
          <View style={S.rowGap10}>
            <TouchableOpacity onPress={toggleSidebar}>
              <Icon name="menu" size={24} color={C.headerText} />
            </TouchableOpacity>
            <Image source={buddhadhamBG} style={S.logo} />
          </View>
        </View>

        {/* กลาง: ชื่อแอป */}
        <View pointerEvents="none" style={S.headerCenter}>
          <Text style={[S.headerTitle, S.headerText]}>
            {`พุทธธรรม`}
          </Text>
        </View>

        {/* ด้านขวา: toggle ธีม + ชื่อ user + logout/login */}
        <View style={S.headerSideRight}>
          {/* ปุ่มเปลี่ยนธีม */}
          <TouchableOpacity
            onPress={toggleTheme}
            style={S.themeChip}
          >
            <View style={S.rowGap6}>
              <Icon
                name={isDark ? "moon" : "sunny"}
                size={16}
                color={C.chipText}
              />
              <Text style={S.themeChipText}>
                {isDark ? "Dark" : "Light"}
              </Text>
            </View>
          </TouchableOpacity>

          {/* แสดง user หรือปุ่ม login */}
          {user ? (
            <View style={S.rowCenter}>
              <View style={[S.userBadge, S.chipBg]}>
                <Text
                  style={[S.userNameText, S.chipText]}
                  numberOfLines={1}
                >
                  {user.name || "ผู้ใช้"}
                </Text>
              </View>
              <TouchableOpacity onPress={handleLogout}>
                <View style={S.logoutButton}>
                  <Text
                    style={[S.logoutText, S.headerText]}
                  >
                    ออกจากระบบ
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => navigation.navigate("Login")}
            >
              <View style={[S.loginButton, S.chipBg]}>
                <Text style={[S.loginText, S.chipText]}>
                  ลงชื่อเข้าใช้
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* =============== Body =============== */}
      <KeyboardAvoidingView style={S.flex1}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={[S.background, S.containerBg, S.flex1]}>
            {/* รูปพื้นหลังแบบจาง ๆ */}
            <Image source={buddhadhamBG} style={S.bgWatermark} />

            {/* ถ้า user อยู่และกำลังโหลด history → แสดง spinner */}
            {user && loadingHistory ? (
              <View style={S.loadingWrap}>
                <ActivityIndicator />
                <Text
                  style={
                    isDark ? S.loadingTextDark : S.loadingTextLight
                  }
                >
                  กำลังโหลดประวัติ...
                </Text>
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={messages}
                renderItem={({ item }) => (
                  <MessageItem
                    item={item}
                    isDark={isDark}
                    styles={S}
                  />
                )}
                keyExtractor={(item) => item.id.toString()}
                style={S.flex1}
                contentContainerStyle={S.listContent(
                  listContentPadBottom
                )}
                ListFooterComponent={
                  <View style={S.footerExtraGap} />
                }
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => {
                  if (!shouldScrollRef.current) return;
                  requestAnimationFrame(() => {
                    scrollToBottom(false, true);
                  });
                }}
                onScrollBeginDrag={() => {
                  // ผู้ใช้เริ่มเลื่อนเอง → ปิด auto scroll ชั่วคราว
                  shouldScrollRef.current = false;
                }}
                onScroll={(e) => {
                  const {
                    contentOffset,
                    layoutMeasurement,
                    contentSize,
                  } = e.nativeEvent;
                  const paddingToBottom = 40;
                  const isAtBottom =
                    contentOffset.y +
                      layoutMeasurement.height >=
                    contentSize.height - paddingToBottom;

                  if (isAtBottom) {
                    shouldScrollRef.current = true;
                  }
                }}
                scrollEventThrottle={16}
              />
            )}

            {/* แสดง chip ชื่อไฟล์แนบลอยเหนือ input bar ถ้ามีไฟล์ */}
            {!!attachment && (
              <View
                style={[
                  S.attachmentFloat,
                  { bottom: inputBarH + 8 },
                ]}
              >
                <Icon
                  name="document-text"
                  size={14}
                  color={C.attachmentIcon}
                />
                <Text
                  numberOfLines={1}
                  style={[S.attachmentText, S.attachmentText]}
                >
                  {attachment.name}
                </Text>
                <TouchableOpacity
                  onPress={removeAttachment}
                  style={S.attachmentCloseBtn}
                >
                  <Icon
                    name="close"
                    size={14}
                    color={C.attachmentIcon}
                  />
                </TouchableOpacity>
              </View>
            )}

            {/* =============== Input bar =============== */}
            <View
              style={[S.inputContainerFixed, S.inputBarTheme]}
              onLayout={(e) =>
                setInputBarH(e.nativeEvent.layout.height || 0)
              }
            >
              {/* บนเว็บ: ใช้ <textarea> แทน TextInput */}
              <textarea
                ref={webRef}
                value={inputText}
                placeholder="พิมพ์ข้อความ..."
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  // กด Enter (ไม่กด Shift) = ส่งข้อความ
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) triggerSend();
                  }
                }}
                disabled={sending}
                style={S.webTextArea}
                onInput={adjustWebHeight}
              />

              {/* ปุ่มแนบไฟล์ */}
              <TouchableOpacity
                onPress={pickAttachment}
                activeOpacity={0.85}
                style={[S.actionButton, S.attachBtn]}
                accessibilityRole="button"
                accessibilityLabel="แนบไฟล์ข้อความ"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="attach" size={20} color="#fff" />
              </TouchableOpacity>

              {/* ปุ่ม microhpone พิมพ์ด้วยเสียง (web เท่านั้น) */}
              <TouchableOpacity
                onPress={recording ? stopVoice : startVoice}
                activeOpacity={0.85}
                style={[
                  S.actionButton,
                  recording ? S.actionBtnCancel : S.actionBtnSend,
                  S.mr8,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  recording
                    ? "หยุดพิมพ์ด้วยเสียง"
                    : "พิมพ์ด้วยเสียง"
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon
                  name={recording ? "mic-off" : "mic"}
                  size={20}
                  color="#fff"
                />
              </TouchableOpacity>

              {/* ปุ่มส่ง / ปุ่มหยุดการส่ง */}
              {sending ? (
                // ถ้ากำลังส่ง: แสดงปุ่ม stop หรือ spinner (ก่อน showStop = true)
                <TouchableOpacity
                  onPress={showStop ? cancelSending : undefined}
                  disabled={!showStop}
                  activeOpacity={0.85}
                  style={[
                    S.actionButton,
                    showStop
                      ? S.actionBtnCancel
                      : S.actionBtnSendDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showStop ? "ยกเลิกการส่ง" : "กำลังส่ง..."
                  }
                  hitSlop={{
                    top: 8,
                    bottom: 8,
                    left: 8,
                    right: 8,
                  }}
                >
                  {showStop ? (
                    <Icon name="stop" size={20} color="#fff" />
                  ) : (
                    <ActivityIndicator color="#fff" />
                  )}
                </TouchableOpacity>
              ) : (
                // ปุ่มส่งปกติ
                <TouchableOpacity
                  onPress={() => {
                    if (canSend) triggerSend();
                  }}
                  disabled={!canSend}
                  activeOpacity={0.85}
                  style={[
                    S.actionButton,
                    S.actionBtnSend,
                    !canSend ? S.disabled06 : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="ส่งข้อความ"
                  hitSlop={{
                    top: 8,
                    bottom: 8,
                    left: 8,
                    right: 8,
                  }}
                >
                  <Icon name="send" size={20} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      {/* =============== Popup menu (สามจุดของห้องแชท) =============== */}
      <Modal
        transparent
        visible={!!menuFor}
        animationType="fade"
        onRequestClose={closeItemMenu}
      >
        {/* พื้นหลัง popup (คลิกเพื่อปิด) */}
        <TouchableOpacity
          style={S.popupBackdrop}
          activeOpacity={1}
          onPress={closeItemMenu}
        />

        {/* กล่อง popup */}
        <View style={[S.popupMenu, getPopupStyle()]}>
          <View style={S.popupArrow} />

          <TouchableOpacity
            style={S.popupItem}
            onPress={() => {
              const id = menuFor;
              if (!id) return;
              startRenameInline(id);
              closeItemMenu();
            }}
          >
            <Text>แก้ไขชื่อแชต</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={S.popupItem}
            onPress={() => {
              closeItemMenu();
              if (menuFor) deleteChat(menuFor);
            }}
          >
            <Text style={S.dangerText}>ลบแชตนี้</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={S.popupItem}
            onPress={closeItemMenu}
          >
            <Text>ยกเลิก</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* =============== Styles =============== */
        const makeStyles = (C, isDark, inputHeight, BUBBLE_MAX_W, cornerShift) =>
  StyleSheet.create({
    container: { flex: 1 },
    withStatusBarPad: { paddingTop: StatusBar.currentHeight || 20 },
    containerBg: { backgroundColor: C.containerBg },
    flex1: { flex: 1 },

    /* =============== Sidebar =============== */
    sidebar: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      width: 260,
      padding: 14,
      zIndex: 5,
    },
    sidebarBg: { backgroundColor: C.sidebarBg },
    sidebarBorderRight: { borderRightColor: C.divider, borderRightWidth: 1 },
    sidebarHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    sidebarTitle: { fontWeight: "bold", fontSize: 16 },
    sidebarTitleColor: { color: C.sidebarText },
    padLeft8: { paddingLeft: 8 },
    padV10: { paddingVertical: 10 },
    rowCenter: { flexDirection: "row", alignItems: "center" },
    rowGap10: { flexDirection: "row", alignItems: "center", columnGap: 10 },
    rowGap6: { flexDirection: "row", alignItems: "center", columnGap: 6 },

    sidebarItemRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 10,
      borderBottomWidth: 1,
    },
    sidebarItemBorder: { borderColor: C.divider },
    sidebarItemActiveDark: { backgroundColor: "#C9CCD3" },
    sidebarItemActiveLight: { backgroundColor: "#E6E9F0" },
    sidebarItemRadiusPad: { borderRadius: 8, paddingHorizontal: 8 },
    sidebarItemText: { paddingRight: 8 },
    sidebarTextColor: { color: C.sidebarText },
    bold700: { fontWeight: "700" },
    dotButton: { paddingHorizontal: 4, paddingVertical: 4 },
    sidebarButton: {
      padding: 10,
      borderRadius: 8,
      alignItems: "center",
      marginTop: 10,
    },
    sidebarBottom: { marginTop: "auto" },

    /* =============== Overlay =============== */
    backdrop: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 4,
    },
    overlay: { backgroundColor: C.overlay },

    /* =============== Header =============== */
    header: {
      height: 60,
      paddingHorizontal: 12,
      justifyContent: "center",
      zIndex: 2,
    },
    headerBg: { backgroundColor: C.headerBg },
    headerCenter: {
      position: "absolute",
      left: 0,
      right: 0,
      alignItems: "center",
    },
    headerSideLeft: {
      position: "absolute",
      left: 10,
      top: 0,
      bottom: 0,
      justifyContent: "center",
    },
    headerSideRight: {
      position: "absolute",
      right: 10,
      top: 0,
      bottom: 0,
      height: "100%",
      justifyContent: "center",
      alignItems: "center",
      flexDirection: "row",
      columnGap: 8,
    },

    headerTitle: { fontSize: 18, fontWeight: "bold", letterSpacing: 0.3 },
    headerText: { color: C.headerText },

    /* =============== Chips / User Badge =============== */
    themeChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: C.chipBg,
    },
    themeChipText: { color: C.chipText, fontSize: 12 },
    loginButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
    loginText: { fontSize: 14 },
    chipBg: { backgroundColor: C.chipBg },
    chipText: { color: C.chipText },
    userBadge: {
      maxWidth: 160,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    userNameText: { fontSize: 16 },
    logoutButton: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
      backgroundColor: "transparent",
    },
    logoutText: { fontSize: 14 },
    whiteText: { color: "#fff" },
    blackText: { color: "#111" },
    guestTextInfo: { color: "#555" },

    /* =============== Background =============== */
    background: { flex: 1 },
    bgWatermark: {
      position: "absolute",
      width: "85%",
      height: "85%",
      opacity: isDark ? 0.08 : 0.12,
      alignSelf: "center",
      top: "3%",
      tintColor: isDark ? "#000" : "#334155",
      resizeMode: "contain",
    },
    logo: {
      width: 34,
      height: 34,
      resizeMode: "contain",
      tintColor: C.logoTint,
    },

    footerExtraGap: { height: EXTRA_BOTTOM_GAP },
    listContent: (padBottom) => ({
      paddingTop: 12,
      paddingBottom: padBottom,
    }),

    /* =============== Messages =============== */
    msgRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingHorizontal: 10,
      marginVertical: 6,
    },
    rowR: { flexDirection: "row-reverse" },
    rowL: { flexDirection: "row" },

    avatarWrap: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      overflow: "hidden",
      borderWidth: 2,
      borderColor: C.avatarRing,
      backgroundColor: "#fff",
    },
    avatarImg: { width: "100%", height: "100%" },

    messageWrapper: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
      marginTop: cornerShift,
      maxWidth: BUBBLE_MAX_W,
      flexShrink: 1,
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
    },
    bubbleUser: {
      backgroundColor: C.bubbleUserBg,
      alignSelf: "flex-end",
      borderTopLeftRadius: 16,
      borderTopRightRadius: 6,
    },
    bubbleBot: {
      backgroundColor: C.bubbleBotBg,
      alignSelf: "flex-start",
      borderTopLeftRadius: 6,
      borderTopRightRadius: 16,
    },
    bubbleUserText: { color: C.bubbleUserText, fontSize: 16 },
    bubbleBotText: { color: C.bubbleBotText, fontSize: 16 },

    pendingRow: { flexDirection: "row", alignItems: "center", columnGap: 8 },

    /* =============== Markdown =============== */
    mdBodyUser: {
      fontSize: 16,
      color: C.bubbleUserText,
      lineHeight: 22,
      ...(Platform.OS === "web"
        ? { wordBreak: "break-word", overflowWrap: "anywhere" }
        : {}),
    },
    mdBodyBot: {
      fontSize: 16,
      color: C.bubbleBotText,
      lineHeight: 22,
      ...(Platform.OS === "web"
        ? { wordBreak: "break-word", overflowWrap: "anywhere" }
        : {}),
    },
    mdStrongUser: { color: C.bubbleUserText },
    mdStrongBot: { color: C.bubbleBotText },
    mdEmUser: { color: C.bubbleUserText },
    mdEmBot: { color: C.bubbleBotText },
    mdCodeBlock: {
      color: isDark ? "#fff" : "#0F172A",
      backgroundColor: isDark ? "#2b2b2b" : "#f1f5f9",
      borderRadius: 8,
      padding: 8,
    },
    mdBlockquote: {
      color: isDark ? "#fff" : "#0F172A",
      backgroundColor: isDark ? "#2b2b2b" : "#f1f5f9",
      fontStyle: "italic",
      borderLeftWidth: 3,
      borderLeftColor: isDark ? "#64748b" : "#c7d2fe",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
    },

    timeText: {
      fontSize: 10,
      color: C.timeText,
      marginHorizontal: 6,
      marginTop: 4,
      maxWidth: BUBBLE_MAX_W,
    },
    alignRight: { alignSelf: "flex-end", textAlign: "right" },
    alignLeft: { alignSelf: "flex-start", textAlign: "left" },

    /* =============== Loading =============== */
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    loadingTextDark: { color: "#ddd", marginTop: 8 },
    loadingTextLight: { color: "#333", marginTop: 8 },

    /* =============== Input bar (web textarea used) =============== */
    inputContainerFixed: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 12,
      borderTopWidth: 1,
      position: "relative",
    },
    inputBarTheme: {
      backgroundColor: C.inputBarBg,
      borderTopColor: C.border,
    },

    webTextArea: {
      flex: 1,
      marginRight: 8,
      backgroundColor: C.inputBg,
      color: "#111",
      borderRadius: 22,
      borderWidth: 1,
      borderColor: C.border,
      outlineStyle: "none",
      resize: "none",
      paddingTop: PAD_V_TOP,
      paddingBottom: PAD_V_BOTTOM,
      paddingHorizontal: 14,
      fontSize: 16,
      lineHeight: `${LINE_H}px`,
      minHeight: MIN_H,
      maxHeight: MAX_H,
      boxSizing: "border-box",
      overflowY: inputHeight >= MAX_H ? "auto" : "hidden",
      opacity: 1,
    },

    /* =============== Attachment chip =============== */
    attachmentFloat: {
      position: "absolute",
      left: 20,
      right: 120,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      zIndex: 50,
      elevation: 12,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    attachmentText: {
      marginLeft: 6,
      flex: 1,
      color: "#0F172A",
      ...(Platform.OS === "web"
        ? {
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
          }
        : {}),
    },
    attachmentCloseBtn: { paddingHorizontal: 4, paddingVertical: 2 },

    /* =============== Buttons =============== */
    actionButton: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 9999,
      paddingVertical: 10,
      paddingHorizontal: 14,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    attachBtn: { backgroundColor: C.sendBtn, marginRight: 8 },
    actionBtnSend: { backgroundColor: C.sendBtn },
    actionBtnCancel: { backgroundColor: C.cancelBtn },
    actionBtnSendDisabled: { backgroundColor: C.sendBtn, opacity: 0.6 },
    disabled06: { opacity: 0.6 },
    mr8: { marginRight: 8 },

    /* =============== Popup =============== */
    popupBackdrop: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: "transparent",
    },
    popupMenu: {
      position: "absolute",
      backgroundColor: "#fff",
      borderRadius: 12,
      paddingVertical: 6,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
      zIndex: 1000,
    },
    popupArrow: {
      position: "absolute",
      top: -8,
      left: 16,
      width: 0,
      height: 0,
      borderLeftWidth: 8,
      borderRightWidth: 8,
      borderBottomWidth: 8,
      borderLeftColor: "transparent",
      borderRightColor: "transparent",
      borderBottomColor: "#fff",
    },
    popupItem: { paddingVertical: 10, paddingHorizontal: 14 },
    dangerText: { color: "#e74c3c" },

    /* =============== Inline rename =============== */
    renameInlineRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      width: "100%",
    },
    renameInlineInput: {
      flex: 1,
      minWidth: 0,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontSize: 14,
    },
    renameInlineInputTheme: { borderColor: C.divider, backgroundColor: "#fff" },
    renameInlineBtns: {
      flexDirection: "row",
      alignItems: "center",
    },
    inlineIconBtn: { paddingHorizontal: 6, paddingVertical: 4 },

    /* =============== Helpers =============== */
    flex1Min0: { flex: 1, minWidth: 0 },
  });
      
