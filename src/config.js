/**
 * ParkGrid Client Configuration & Environment Normalizer
 */
const RAW_URL = import.meta.env.VITE_API_URL || '';

// Cleanly strip all trailing slashes to guarantee clean routing without double slashes
export const API_BASE = RAW_URL.replace(/\/+$/, '');
