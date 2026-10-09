import { handlers } from '@/auth';

// Routes OAuth gérées par Auth.js : /api/auth/signin, /api/auth/callback/google, ...
export const { GET, POST } = handlers;
