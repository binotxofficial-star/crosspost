import { Dashboard } from "@/components/dashboard";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Crosspost</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          One upload. TikTok, Instagram and YouTube.
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Connect your accounts once, add your video with a title, description and hashtags, and publish it
          everywhere in one go.
        </p>
      </header>
      <Dashboard />
    </main>
  );
}
