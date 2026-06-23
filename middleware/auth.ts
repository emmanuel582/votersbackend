import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

export interface AdminRequest extends Request {
  admin?: {
    id: string;
    email: string;
    role: string;
  };
}

export const requireAdmin = async (req: AdminRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify JWT with Supabase Auth
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Fetch Admin role
    const { data: adminData, error: dbError } = await supabaseAdmin
      .from('admins')
      .select('role')
      .eq('id', user.id)
      .single();

    if (dbError || !adminData) {
      return res.status(403).json({ error: 'User is not an admin' });
    }

    req.admin = {
      id: user.id,
      email: user.email!,
      role: adminData.role
    };

    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
};

export const requireSuperAdmin = (req: AdminRequest, res: Response, next: NextFunction) => {
  if (req.admin?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  next();
};
