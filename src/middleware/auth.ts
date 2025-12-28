import { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";

// Extend interface Request supaya kita bisa simpan data user di dalamnya
export interface AuthRequest extends Request {
  user?: any;
  userRole?: string;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // 1. Ambil token dari header "Authorization: Bearer <TOKEN>"
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Akses ditolak, token tidak ditemukan" });
    }

    const token = authHeader.split(" ")[1];

    // 2. Verifikasi token ke Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ message: "Token tidak valid atau sesi berakhir" });
    }

    // 3. Ambil Role dari tabel profiles yang kita buat di Supabase tadi
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

    // 4. Simpan data user & role ke objek request agar bisa dipakai di controller
    req.user = user;
    req.userRole = profile?.role || "user";

    next();
  } catch (err) {
    return res.status(500).json({ message: "Internal Server Error", error: err });
  }
};

// Middleware khusus untuk proteksi route Admin
export const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ message: "Akses terlarang: Anda bukan Admin" });
  }
  next();
};
