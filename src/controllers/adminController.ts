import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const getAdminStats = async (req: Request, res: Response) => {
  try {
    // Ambil data order beserta nama dari profile (Foreign Key)
    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        `
        *,
        profiles (full_name)
      `
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Hitung ringkasan statistik
    const totalOrders = orders.length;
    const totalRevenue = orders.filter((o) => o.status === "paid" || o.status === "shipped").reduce((sum, o) => sum + Number(o.total_amount), 0);
    const pendingOrders = orders.filter((o) => o.status === "pending").length;

    res.json({
      stats: { totalOrders, totalRevenue, pendingOrders },
      orders,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, tracking_number } = req.body;
    const user = (req as any).user;

    // 1. Validasi Akses (Role Check)
    if (user.role !== "admin") {
      // User biasa HANYA boleh mengubah ke 'completed'
      if (status !== "completed") {
        return res.status(403).json({ message: "Akses ditolak. Anda hanya bisa menyelesaikan pesanan." });
      }

      // Pastikan order milik user yang sedang login
      const { data: checkOrder, error: checkError } = await supabase.from("orders").select("user_id").eq("id", id).single();

      if (checkError || checkOrder?.user_id !== user.id) {
        return res.status(403).json({ message: "Ini bukan pesanan Anda" });
      }
    }

    // 2. Siapkan data untuk diupdate
    // Gunakan spread operator agar kita hanya update field yang dikirim saja
    const updatePayload: Record<string, any> = { status };

    // Hanya Admin yang biasanya mengirim tracking_number
    if (tracking_number !== undefined) {
      updatePayload.tracking_number = tracking_number;
    }

    // 3. Eksekusi Update
    const { data, error } = await supabase.from("orders").update(updatePayload).eq("id", id).select().single();

    if (error) throw error;

    res.json({
      success: true,
      message: `Status pesanan berhasil diubah menjadi ${status}`,
      data: data,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Terjadi kesalahan";
    res.status(500).json({ message: msg });
  }
};
