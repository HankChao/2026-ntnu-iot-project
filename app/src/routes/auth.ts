// ==============================================================================
// Authentication Routes (Simple Admin Auth)
// ==============================================================================

import { Hono } from 'hono';

export const authRoute = new Hono();

// POST /api/v1/auth/login
authRoute.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body;

  const expectedPassword = process.env.ADMIN_PASSWORD || 'adminpassword';
  if (username === 'admin' && password === expectedPassword) {
    return c.json({
      success: true,
      user: { username: 'admin', role: 'administrator' },
      token: 'maps6-session-token',
    });
  }

  return c.json({ success: false, error: 'Invalid username or password' }, 401);
});

// POST /api/v1/auth/logout
authRoute.post('/logout', (c) => {
  return c.json({ success: true, message: 'Logged out' });
});

// GET /api/v1/auth/me
authRoute.get('/me', (c) => {
  return c.json({
    success: true,
    user: { username: 'admin', role: 'administrator' },
  });
});
