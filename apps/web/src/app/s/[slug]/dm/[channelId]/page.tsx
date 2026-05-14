"use client";

import { useParams } from "next/navigation";
import { MessageArea } from "@/components/message-area";

export default function DmPage() {
  const params = useParams();
  const channelId = params.channelId as string;
  return <MessageArea channelId={channelId} />;
}
