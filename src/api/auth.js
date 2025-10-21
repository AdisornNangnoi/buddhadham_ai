import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * AuthContext — ใช้สำหรับจัดการสถานะผู้ใช้ (Login / Logout)
 * และเก็บ token ลง storage เพื่อให้ยังล็อกอินอยู่ได้แม้ปิดแอป
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);           // เก็บข้อมูลผู้ใช้ปัจจุบัน
  const [isRestoring, setIsRestoring] = useState(true); // สถานะกำลังโหลดข้อมูลผู้ใช้จาก storage

  /**
   * โหลดข้อมูลผู้ใช้จาก AsyncStorage ตอนเปิดแอป
   * เพื่อรักษาสถานะล็อกอิน
   */
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("auth:user");
        if (raw) setUser(JSON.parse(raw));
      } catch (e) {
        console.warn("Load auth from storage failed:", e);
      } finally {
        setIsRestoring(false);
      }
    })();
  }, []);

  /**
   * login(userObj)
   * บันทึกข้อมูลผู้ใช้ใหม่ → setUser → เก็บลง AsyncStorage
   */
  const login = async (userObj) => {
    setUser(userObj);
    await AsyncStorage.setItem("auth:user", JSON.stringify(userObj));
  };

  /**
   * logout()
   * ลบข้อมูลผู้ใช้ออกจาก state และ AsyncStorage
   */
  const logout = async () => {
    setUser(null);
    await AsyncStorage.removeItem("auth:user");
  };

  /**
   * value ที่แชร์ให้ component อื่นใช้งานผ่าน useAuth()
   */
  const value = useMemo(
    () => ({
      user,
      isRestoring,
      login,
      logout,
    }),
    [user, isRestoring]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth()
 * Custom hook สำหรับเรียกใช้งาน context ของ Auth
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
