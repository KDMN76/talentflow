import Link from "next/link";
import { Compass } from "lucide-react";

/** Nette 404 i.p.v. de kale Next-default. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
          <Compass className="h-6 w-6 text-indigo-500" />
        </div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Pagina niet gevonden
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Deze pagina bestaat niet (meer) of het adres klopt niet.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          Naar het dashboard
        </Link>
      </div>
    </div>
  );
}
