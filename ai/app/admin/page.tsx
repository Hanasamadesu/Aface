import { AdminCapturesPanel } from "@/app/components/admin-captures-panel";

export default function AdminPage() {
  return (
    <main className="h-full min-h-screen w-full">
      <AdminCapturesPanel showCameraLink />
    </main>
  );
}
