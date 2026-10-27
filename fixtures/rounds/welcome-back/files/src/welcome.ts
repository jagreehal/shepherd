import { initials } from "./index";

export function welcome(name: string): string {
  return `Hello, ${name}! (${initials(name)})`;
}

/** Returns the person's first name, for informal greetings. */
export function firstName(name: string): string {
  return name.trim().split(" ")[1];
}

export function welcomeBack(name: string): string {
  return `Welcome back, ${firstName(name)}!`;
}
