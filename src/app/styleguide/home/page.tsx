import { notFound } from "next/navigation";
import { HomeView } from "@/components/home/home-view";
import { HOME_PREVIEW } from "../home-preview-data";

// DEVELOPMENT ONLY. The Home page rendered by its production components on
// SYNTHETIC data (home-preview-data.ts), for design review without the
// investor's real figures. Not in the navigation; a 404 in production.
export const dynamic = "force-static";

export default function HomePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main>
      <HomeView data={HOME_PREVIEW} />
    </main>
  );
}
