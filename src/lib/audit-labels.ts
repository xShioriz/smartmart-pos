// ชื่อภาษาไทยของ action ใน AuditLog (action ที่ไม่รู้จักแสดงเป็นรหัสเดิม)
export const AUDIT_LABELS: Record<string, string> = {
  LOGIN_FAILED: "เข้าสู่ระบบไม่สำเร็จ",
  USER_CREATE: "เพิ่มผู้ใช้", USER_UPDATE: "แก้ไขผู้ใช้", USER_ROLE_CHANGE: "เปลี่ยนสิทธิ์ผู้ใช้", USER_ENABLE: "เปิดใช้งานผู้ใช้", USER_DISABLE: "ปิดใช้งานผู้ใช้", USER_PASSWORD_RESET: "รีเซ็ตรหัสผ่านผู้ใช้",
  CATEGORY_CREATE: "เพิ่มหมวดหมู่", CATEGORY_UPDATE: "แก้ไขหมวดหมู่", CATEGORY_DELETE: "ลบหมวดหมู่",
  PRODUCT_CREATE: "เพิ่มสินค้า", PRODUCT_UPDATE: "แก้ไขสินค้า", PRODUCT_PRICE_CHANGE: "เปลี่ยนราคา/ทุนสินค้า", PRODUCT_ENABLE: "เปิดใช้งานสินค้า", PRODUCT_DISABLE: "ปิดใช้งานสินค้า",
  STOCK_RECEIVE: "รับสินค้าเข้า", STOCK_ADJUST: "ปรับสต็อก",
  PROMOTION_CREATE: "เพิ่มโปรโมชั่น", PROMOTION_UPDATE: "แก้ไขโปรโมชั่น", PROMOTION_ENABLE: "เปิดใช้งานโปรโมชั่น", PROMOTION_DISABLE: "ปิดใช้งานโปรโมชั่น",
  MEMBER_CREATE: "เพิ่มสมาชิก", MEMBER_UPDATE: "แก้ไขสมาชิก", MEMBER_ENABLE: "เปิดใช้งานสมาชิก", MEMBER_DISABLE: "ปิดใช้งานสมาชิก",
  SALE_RETURN: "คืนสินค้า/คืนเงิน",
  PAYMENT_CANCEL: "ยกเลิก QR (แคชเชียร์)", PAYMENT_REVIEW_FULFILLED: "ตรวจสอบบิลที่จ่ายแล้ว: ทำรายการต่อ", PAYMENT_REVIEW_REFUNDED: "ตรวจสอบบิลที่จ่ายแล้ว: คืนเงินแล้ว",
};
export const auditLabel = (a: string) => AUDIT_LABELS[a] ?? a;
