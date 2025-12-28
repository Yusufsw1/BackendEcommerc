import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { supabase } from "../config/supabase";

export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    // User ID didapat dari middleware auth yang sudah kita buat sebelumnya
    const userId = req.user?.id;

    const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", userId).single();

    if (error) {
      return res.status(404).json({ message: "Profil tidak ditemukan" });
    }

    return res.status(200).json({
      user: req.user,
      profile: profile,
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
