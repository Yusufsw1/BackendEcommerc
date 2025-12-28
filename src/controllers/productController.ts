import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { supabase } from "../config/supabase";
import cloudinary from "../config/cloudinary";
import axios from "axios";
import midtransClient from "midtrans-client";

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || "",
  clientKey: process.env.MIDTRANS_CLIENT_KEY || "",
});

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  weight?: number;
}

interface MidtransWebhookBody {
  order_id: string;
  transaction_status: string;
  fraud_status?: string;
  status_code: string;
}

export const createProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, price, stock } = req.body;

    // Pastikan req.files terbaca sebagai array
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Minimal 1 gambar wajib diunggah" });
    }

    // Gunakan Promise.all untuk mengunggah semua foto secara paralel
    const uploadPromises = files.map((file) => {
      return new Promise<string>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream({ folder: "toko-online" }, (error, result) => {
          if (error) reject(error);
          else resolve(result!.secure_url); // Ambil URL aman
        });
        uploadStream.end(file.buffer);
      });
    });

    // Tunggu semua URL terkumpul dalam satu array
    const imageUrls = await Promise.all(uploadPromises);

    // DEBUG: Cek di terminal apakah array imageUrls isinya lebih dari satu
    // console.log("URLs yang akan disimpan:", imageUrls);

    const { data, error } = await supabase
      .from("products")
      .insert([
        {
          name,
          description,
          price: parseFloat(price),
          stock: parseInt(stock),
          image_url: imageUrls, // Masukkan array hasil Promise.all
        },
      ])
      .select();

    if (error) throw error;
    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const getAllProducts = async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data);
};

export const deleteProduct = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ message: "Produk berhasil dihapus" });
};

export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock, existingImages } = req.body;
    const files = req.files as Express.Multer.File[];

    // 1. Cek dulu apakah produknya ada
    const { data: currentProduct, error: fetchError } = await supabase.from("products").select("*").eq("id", id).single();

    if (fetchError || !currentProduct) {
      return res.status(404).json({ message: "Produk tidak ditemukan" });
    }

    let finalImageUrls = [];

    // 2. Pertahankan foto lama yang tidak dihapus (jika ada kiriman list foto lama dari frontend)
    if (existingImages) {
      finalImageUrls = Array.isArray(existingImages) ? existingImages : [existingImages];
    } else {
      finalImageUrls = currentProduct.image_url; // Default pakai foto lama semua
    }

    // 3. Jika ada upload foto baru, proses ke Cloudinary
    if (files && files.length > 0) {
      const remainingSlots = 5 - finalImageUrls.length;
      if (files.length > remainingSlots) {
        return res.status(400).json({ message: `Slot foto penuh. Sisa slot: ${remainingSlots}` });
      }

      const uploadPromises = files.map((file) => {
        return new Promise<string>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream({ folder: "toko-online" }, (error, result) => {
            if (error) reject(error);
            else resolve(result!.secure_url);
          });
          uploadStream.end(file.buffer);
        });
      });

      const newImageUrls = await Promise.all(uploadPromises);
      finalImageUrls = [...finalImageUrls, ...newImageUrls];
    }

    // 4. Update data di Supabase
    const { data, error } = await supabase
      .from("products")
      .update({
        name,
        description,
        price: parseFloat(price),
        stock: parseInt(stock),
        image_url: finalImageUrls,
      })
      .eq("id", id)
      .select();

    if (error) throw error;

    return res.status(200).json({ message: "Produk berhasil diupdate", data });
  } catch (error: any) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "File terlalu besar (Max 5MB)" });
    }
    return res.status(500).json({ message: error.message });
  }
};

export const getProductById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error || !data) return res.status(404).json({ message: "Produk tidak ditemukan" });
  res.status(200).json(data);
};

export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { items, totalPrice, destination_id, courier, shipping_address } = req.body as {
      items: CartItem[];
      totalPrice: number;
      destination_id: string;
      courier: string;
      shipping_address: string;
    };

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!destination_id || !courier || !items || items.length === 0) {
      return res.status(400).json({ message: "Data tidak lengkap" });
    }

    // 1. HITUNG ONGKIR ULANG DI BACKEND (KEAMANAN)
    const totalWeight = items.reduce((acc, item) => acc + (item.weight || 1000) * item.quantity, 0);

    const shippingParams = new URLSearchParams();
    shippingParams.append("origin", "5296");
    shippingParams.append("destination", destination_id);
    shippingParams.append("weight", totalWeight.toString());
    shippingParams.append("courier", courier);

    const shippingRes = await axios.post(`${process.env.BASE_URL}/calculate/domestic-cost`, shippingParams.toString(), {
      headers: {
        key: process.env.API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const shippingInfo = shippingRes.data.data[0];
    const actualShippingCost = shippingInfo.cost;

    // CARA BENAR:
    // Ambil harga asli barang dengan mengurangi totalPrice dari frontend dengan ongkir yang dikirim frontend
    // ATAU lebih aman: hitung ulang harga barang dari array items
    const subtotalProducts = items.reduce((acc, item) => acc + item.price * item.quantity, 0);

    // Total Akhir = Harga Barang murni + Ongkir asli dari RajaOngkir
    const finalAmount = subtotalProducts + actualShippingCost;

    // 2. INSERT KE TABEL 'orders'
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          user_id: userId,
          total_amount: finalAmount,
          shipping_cost: actualShippingCost,
          destination_id,
          courier: `${shippingInfo.name} - ${shippingInfo.service}`,
          shipping_address: shipping_address,
          status: "pending",
        },
      ])
      .select()
      .single();

    if (orderError) throw orderError;

    // 3. INSERT KE TABEL 'order_items'
    const orderItemsData = items.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      quantity: item.quantity,
      price_at_purchase: item.price,
    }));

    const { error: itemsError } = await supabase.from("order_items").insert(orderItemsData);
    if (itemsError) throw itemsError;

    // 4. UPDATE STOK MENGGUNAKAN RPC (REUSABLE LOGIC)
    // Menggunakan looping untuk setiap item dalam order
    for (const item of items) {
      const { error: stockError } = await supabase.rpc("decrement_stock", {
        row_id: item.id,
        amount: item.quantity,
      });

      if (stockError) {
        console.error(`Gagal update stok produk ${item.id}:`, stockError.message);
        // Tetap lanjut meskipun satu item gagal, atau berikan notifikasi log
      }
    }

    // 5. REQUEST TOKEN KE MIDTRANS
    const parameter = {
      transaction_details: {
        order_id: order.id,
        gross_amount: Math.round(finalAmount), // Pastikan angka bulat
      },
      item_details: [
        ...items.map((item) => ({
          id: item.id,
          price: item.price,
          quantity: item.quantity,
          name: (item.name || "Produk").substring(0, 50), // FIX: substring safe
        })),
        {
          id: "shipping-fee",
          price: Math.round(actualShippingCost),
          quantity: 1,
          name: "Ongkos Kirim",
        },
      ],
      customer_details: {
        shipping_address: {
          address: shipping_address,
        },
      },
      enabled_payments: ["gopay", "shopeepay", "bank_transfer", "indomaret", "alfamart"],
    };

    const calculatedTotal = parameter.item_details.reduce((acc, item) => acc + item.price * item.quantity, 0);
    console.log("=== DEBUG MIDTRANS ===");
    console.log("Daftar Barang:", parameter.item_details);
    console.log("Total di Nota (Sum):", calculatedTotal);
    console.log("Total Tagihan (Gross):", parameter.transaction_details.gross_amount);
    console.log("======================");
    const transaction = await snap.createTransaction(parameter);

    // 6. UPDATE ORDER DENGAN SNAP TOKEN (Penting untuk rekonsiliasi)
    await supabase.from("orders").update({ snap_token: transaction.token }).eq("id", order.id);

    // 7. KIRIM RESPON KE FRONTEND
    res.status(201).json({
      success: true,
      token: transaction.token, // Token untuk munculin popup Snap
      orderId: order.id,
    });
  } catch (error: any) {
    console.error("Checkout Error:", error.message);
    res.status(500).json({ message: "Gagal memproses pesanan" });
  }
};

export const getShippingCost = async (req: Request, res: Response) => {
  try {
    const { items, destination_id, courier } = req.body;

    // Gunakan Key Cost (yang 100 hit)
    const COST_API_KEY = process.env.API_KEY;
    const BASE_URL = process.env.BASE_URL;

    const totalWeight = items.reduce((acc: number, item: any) => {
      return acc + (item.weight || 1000) * item.quantity;
    }, 0);

    const shippingParams = new URLSearchParams();
    shippingParams.append("origin", "5296");
    shippingParams.append("destination", destination_id);
    shippingParams.append("weight", totalWeight.toString());
    shippingParams.append("courier", courier);

    const shippingRes = await axios.post(`${BASE_URL}/calculate/domestic-cost`, shippingParams.toString(), {
      headers: {
        key: COST_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (shippingRes.data.data && shippingRes.data.data.length > 0) {
      const shippingInfo = shippingRes.data.data[0];
      res.json({
        success: true,
        cost: shippingInfo.cost,
        service: shippingInfo.service,
      });
    } else {
      throw new Error("Layanan pengiriman tidak tersedia");
    }
  } catch (error: any) {
    console.error("Cost Error:", error.response?.data || error.message);
    res.status(500).json({ success: false, message: "Gagal menghitung ongkir" });
  }
};

// Fungsi untuk mengambil riwayat pesanan user
export const getUserOrders = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        created_at,
        status,
        total_amount,
        snap_token,
        tracking_number,
        order_items (
          id,
          quantity,
          price_at_purchase,
          products (
            name,
            image_url
          )
        )
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Selalu kembalikan array kosong jika data tidak ada, jangan null
    res.json(data || []);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// 1. Ambil Semua Provinsi
export const getProvinces = async (req: Request, res: Response) => {
  try {
    const key = process.env.DELIVERY_API_KEY?.trim();

    // Log untuk memastikan key tidak kosong di console backend
    console.log("Mengambil provinsi dengan key:", key ? "Key Terdeteksi" : "Key KOSONG!");

    const response = await axios.get(`https://rajaongkir.komerce.id/api/v1/destination/province`, {
      headers: {
        key: key,
        Accept: "application/json",
      },
    });

    res.json(response.data.data || []);
  } catch (error: any) {
    console.error("Detail Error 400:", error.response?.data || error.message);
    res.status(500).json([]);
  }
};

// 2. Ambil Kota berdasarkan ID Provinsi
export const getCities = async (req: Request, res: Response) => {
  try {
    const { province_id } = req.params;
    const response = await axios.get(`https://rajaongkir.komerce.id/api/v1/destination/city/${province_id}`, {
      headers: { key: process.env.DELIVERY_API_KEY },
    });
    res.json(response.data.data);
  } catch (error: any) {
    console.error("Error Cities:", error.message);
    res.status(500).json({ message: "Gagal mengambil data kota" });
  }
};

// 3. Ambil Kecamatan berdasarkan ID Kota
export const getDistricts = async (req: Request, res: Response) => {
  try {
    const { city_id } = req.params;
    const response = await axios.get(`https://rajaongkir.komerce.id/api/v1/destination/district/${city_id}`, {
      headers: { key: process.env.DELIVERY_API_KEY },
    });
    res.json(response.data.data);
  } catch (error: any) {
    console.error("Error Districts:", error.message);
    res.status(500).json({ message: "Gagal mengambil data kecamatan" });
  }
};

export const handleMidtransWebhook = async (req: Request, res: Response) => {
  try {
    const { order_id, transaction_status, fraud_status, status_code, gross_amount, signature_key } = req.body;

    // --- OPSIONAL: VALIDASI SIGNATURE (Agar Aman dari Hacker) ---
    // const crypto = require('crypto');
    // const serverKey = process.env.MIDTRANS_SERVER_KEY!;
    // const hash = crypto.createHash('sha512').update(order_id + status_code + gross_amount + serverKey).digest('hex');
    // if (hash !== signature_key) return res.status(403).json({ message: "Invalid signature" });

    console.log(`Log: Webhook diterima untuk Order ${order_id} [${transaction_status}]`);

    let newStatus = "";

    // Logika penentuan status sesuai standar Midtrans
    if (transaction_status === "capture" || transaction_status === "settlement") {
      if (fraud_status === "accept" || !fraud_status) {
        newStatus = "paid";
      }
    } else if (["cancel", "deny", "expire"].includes(transaction_status)) {
      newStatus = "cancelled";
    } else if (transaction_status === "pending") {
      newStatus = "pending";
    }

    // Jika ada perubahan status, update database Supabase
    if (newStatus !== "") {
      const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", order_id);

      if (error) throw error;
      console.log(`✅ Berhasil update Order ${order_id} menjadi ${newStatus}`);
    }

    // WAJIB: Kirim respon 200 ke Midtrans
    res.status(200).json({ message: "Webhook processed" });
  } catch (error: any) {
    console.error("❌ Webhook Error:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
