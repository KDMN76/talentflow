import axios from "axios";
import { getToken, setToken, clearToken } from "./auth";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api",
  withCredentials: true, // For refresh token cookie
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: add Authorization header
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 + refresh
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 428 Precondition Required: tenant-policy verplicht 2FA en de user is
    // (buiten de grace-period) nog niet enrolled. Stuur naar de setup-
    // pagina — de 2FA-endpoints zelf zijn server-side gewhitelist zodat de
    // wizard daar gewoon werkt.
    if (
      error.response?.status === 428 &&
      error.response.data?.error?.code === "2FA_REQUIRED"
    ) {
      if (
        typeof window !== "undefined" &&
        !window.location.pathname.startsWith("/settings/security/2fa")
      ) {
        window.location.href =
          error.response.data.error.details?.setup_url ??
          "/settings/security/2fa";
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const response = await api.post("/auth/refresh");
        const newToken = response.data.accessToken;
        setToken(newToken);
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearToken();
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
