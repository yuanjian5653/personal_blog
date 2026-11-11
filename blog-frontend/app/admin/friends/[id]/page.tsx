"use client";

import { useParams } from "next/navigation";

import FriendEditor from "@/components/admin/FriendEditor";

export default function EditFriendPage() {
  const params = useParams();
  const id = Number(params?.id);
  return <FriendEditor id={Number.isFinite(id) ? id : null} />;
}
