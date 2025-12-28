import { Router } from "express";
import { createOrder, createProduct, deleteProduct, getAllProducts, getCities, getDistricts, getProductById, getProvinces, getShippingCost, getUserOrders, handleMidtransWebhook, updateProduct } from "../controllers/productController";
import { authMiddleware, isAdmin } from "../middleware/auth";
import { upload } from "../middleware/upload";
import { getAdminStats, updateOrderStatus } from "../controllers/adminController";

const router = Router();

// Admin
router.post("/", authMiddleware, isAdmin, upload.array("images", 5), createProduct);
router.delete("/:id", authMiddleware, isAdmin, deleteProduct);
router.put("/:id", authMiddleware, isAdmin, upload.array("images", 5), updateProduct);
router.patch("/order-status/:id", authMiddleware, updateOrderStatus);
router.get("/stats", authMiddleware, isAdmin, getAdminStats);

//user
router.get("/", getAllProducts);
router.get("/:id", getProductById);
router.post("/orders", authMiddleware, createOrder);
router.get("/orders/my-orders", authMiddleware, getUserOrders);
router.get("/shipping/provinces", getProvinces);
router.get("/shipping/cities/:province_id", getCities);
router.get("/shipping/districts/:city_id", getDistricts);
router.post("/shipping/cost", getShippingCost);
router.post("/midtrans-webhook", handleMidtransWebhook);

export default router;
