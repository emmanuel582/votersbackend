"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const supabase_js_1 = require("./lib/supabase.js");
async function createBucket() {
    const { data, error } = await supabase_js_1.supabaseAdmin.storage.createBucket('nominees', {
        public: true,
        fileSizeLimit: 5242880, // 5MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    });
    if (error) {
        if (error.message.includes('already exists')) {
            console.log('Bucket already exists.');
        }
        else {
            console.error('Failed to create bucket:', error);
        }
    }
    else {
        console.log('Bucket created:', data);
    }
}
createBucket();
//# sourceMappingURL=createBucket.js.map