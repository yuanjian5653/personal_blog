"use client";

import { useParams } from "next/navigation";

import LifeEditor from "@/components/admin/LifeEditor";

export default function EditLifePage() {
  const params = useParams();
  const id = Number(params?.id);
  return <LifeEditor id={Number.isFinite(id) ? id : null} />;
}
