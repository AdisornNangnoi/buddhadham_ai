// src/api/auth.js
import { client } from './client';

export async function loginApi(email, password) {
    const { data } = await client.post('/auth/login', { email, password });
    return data; // คาดว่า { accessToken, refreshToken?, user }
}

export async function registerApi({ username, email, password }) {
    const { data } = await client.post('/auth/register', { username, email, password });
    return data; // คาดว่า { user, message? }
}
