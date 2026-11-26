import { read, write } from "@/lib/storage";

const KEY = "mumble.browser";
// As mumblermapi's TicketRequest.browser accepts it
const ID = /^[A-Za-z0-9-]{16,64}$/;

// A random id this browser keeps. mumblermapi gives each of a person's browsers its own web slot by it, so a
// laptop and a phone can be in voice at once; a second tab in the same browser takes over from the first.
export function loadBrowser(): string {
  const stored = read(KEY);
  if (stored !== null && ID.test(stored)) return stored;
  const id = crypto.randomUUID();
  write(KEY, id);
  return id;
}
