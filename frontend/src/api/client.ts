import axios from 'axios'

// In Docker: nginx proxies /api/ → backend:8000/
// In Vite dev: vite.config proxy maps /api → backend:8000
const BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

export const api = axios.create({
  baseURL: BASE,
  timeout: 30_000,
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg =
      err.response?.data?.detail ??
      err.response?.data?.message ??
      err.message ??
      'Unknown error'
    return Promise.reject(new Error(String(msg)))
  },
)
