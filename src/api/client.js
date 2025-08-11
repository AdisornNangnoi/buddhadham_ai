// src/api/client.js
import axios from 'axios';

const baseURL = process.env.EXPO_PUBLIC_API_BASE_URL; // ตั้งใน .env

export const client = axios.create({
    baseURL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

client.interceptors.request.use((config) => {
    if (!baseURL) {
        return Promise.reject(new Error('API_BASE_URL_NOT_SET'));
    }
    return config;
});

client.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err.message === 'API_BASE_URL_NOT_SET') {
            err.message = 'ยังไม่ตั้งค่า EXPO_PUBLIC_API_BASE_URL';
            return Promise.reject(err);
        }
        if (err.code === 'ECONNABORTED') {
            err.message = 'เชื่อมต่อ API เกินเวลา';
        } else if (err.response) {
            err.message = err.response.data?.message || `เกิดข้อผิดพลาด (${err.response.status})`;
        } else {
            err.message = 'เชื่อมต่อ API ไม่ได้ (API ยังไม่พร้อมหรือเน็ตมีปัญหา)';
        }
        return Promise.reject(err);
    }
);
