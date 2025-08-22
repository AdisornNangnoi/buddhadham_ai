import axios from "axios";

// .env: EXPO_PUBLIC_API_URL=https://buddhadham-server-service.vercel.app
const API = process.env.EXPO_PUBLIC_API_URL || "https://buddhadham-server-service.vercel.app";

const client = axios.create({
  baseURL: `${API}/user`,
  timeout: 10000,
});

export default client;
