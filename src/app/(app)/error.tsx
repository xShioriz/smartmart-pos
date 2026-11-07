"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="เกิดข้อผิดพลาด"
      description="ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง"
      action={<Button onClick={reset}>ลองใหม่</Button>}
    />
  );
}
