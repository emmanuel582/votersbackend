import { Request, Response, NextFunction } from 'express';
export interface AdminRequest extends Request {
    admin?: {
        id: string;
        email: string;
        role: string;
    };
}
export declare const requireAdmin: (req: AdminRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const requireSuperAdmin: (req: AdminRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=auth.d.ts.map