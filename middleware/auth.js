"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = exports.requireAdmin = void 0;
const supabase_js_1 = require("../lib/supabase.js");
const requireAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    const token = authHeader.split(' ')[1];
    try {
        // Verify JWT with Supabase Auth
        const { data: { user }, error: authError } = await supabase_js_1.supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        // Fetch Admin role
        const { data: adminData, error: dbError } = await supabase_js_1.supabaseAdmin
            .from('admins')
            .select('role')
            .eq('id', user.id)
            .single();
        if (dbError || !adminData) {
            return res.status(403).json({ error: 'User is not an admin' });
        }
        req.admin = {
            id: user.id,
            email: user.email,
            role: adminData.role
        };
        next();
    }
    catch (error) {
        res.status(500).json({ error: 'Authentication failed' });
    }
};
exports.requireAdmin = requireAdmin;
const requireSuperAdmin = (req, res, next) => {
    if (req.admin?.role !== 'super_admin') {
        return res.status(403).json({ error: 'Super Admin access required' });
    }
    next();
};
exports.requireSuperAdmin = requireSuperAdmin;
//# sourceMappingURL=auth.js.map