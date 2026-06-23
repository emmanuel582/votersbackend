"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function main() {
    const { error } = await supabase.from('app_settings').update({ voting_status: 'OPEN' }).eq('id', 'singleton');
    if (error) {
        console.error('Error unpausing:', error);
    }
    else {
        console.log('Unpaused voting successfully!');
    }
}
main();
//# sourceMappingURL=unpause.js.map