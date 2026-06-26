"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const supabaseAdmin = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
async function check() {
    const { count: total } = await supabaseAdmin.from('votes').select('*', { count: 'exact', head: true });
    const { count: recorded } = await supabaseAdmin.from('votes').select('*', { count: 'exact', head: true }).eq('vote_recorded', true);
    const { count: success } = await supabaseAdmin.from('votes').select('*', { count: 'exact', head: true }).eq('paystack_status', 'success');
    console.log(`TOTAL ROWS IN DB: ${total}`);
    console.log(`RECORDED IN DB: ${recorded}`);
    console.log(`SUCCESS IN DB: ${success}`);
}
check().catch(console.error);
//# sourceMappingURL=check_db.js.map