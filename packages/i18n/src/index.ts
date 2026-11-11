import type { Locale } from './config';
import en from './en.json';
import ru from './ru.json';
import uz from './uz.json';

export * from './config';

export type Messages = typeof uz;

export const messages: Record<Locale, Messages> = { uz, ru, en };
