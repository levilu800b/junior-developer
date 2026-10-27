import Image from "next/image";
import { Suspense } from "react";

import Content from "@/components/Content";
import { getData } from "@/lib/data";

async function ContentList() {
  const items = await getData().catch((error) => {
    console.error(error);
    return null;
  });

  if (!items) {
    return (
      <p role="alert" className="rounded-md bg-white/10 p-4">
        Sorry, the answers couldn&apos;t be loaded. Check the backend is running at
        http://localhost:8000 and refresh the page.
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      {items.map((item, index) => (
        <Content key={index} item={item} />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col items-center gap-8 p-4 sm:p-8">
      <div className="flex flex-col items-center text-center">
        <Image
          src="/logo.png"
          alt="Citizens Advice SORT"
          width={150}
          height={150}
          priority
        />
        <h1 className="mt-4 text-2xl font-bold">Citizens Advice SORT</h1>
        <h2 className="text-lg font-medium">Junior Developer Practical</h2>
      </div>
      {/* Anything that fetches data goes inside Suspense, which shows the fallback until it's ready */}
      <Suspense fallback={<p>Loading...</p>}>
        <ContentList />
      </Suspense>
    </main>
  );
}
