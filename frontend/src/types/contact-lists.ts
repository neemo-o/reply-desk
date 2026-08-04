/**
 * Tipos de Contact Lists — fonte canônica de `ContactList` está em
 * `@/types/bots`. Reexportamos aqui para manter o caminho
 * `@/types/contact-lists` usado por hooks/services já existentes e não
 * duplicar a interface entre `bots.ts` e `contact-lists.ts`.
 */
export type { ContactList } from "@/types/bots";

export interface ContactListItem {
  id: string;
  contactListId: string;
  contactId: string;
  contact?: {
    id: string;
    name: string | null;
    phone: string;
  };
}

export interface ContactListDetail {
  id: string;
  name: string;
  createdAt: string;
  _count?: { items: number };
  items: ContactListItem[];
}

export interface CreateContactListPayload {
  name: string;
}

export interface AddContactsPayload {
  contactIds: string[];
}
