export interface ContactList {
  id: string;
  name: string;
  createdAt: string;
  _count?: { items: number };
}

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

export interface CreateContactListPayload {
  name: string;
}

export interface AddContactsPayload {
  contactIds: string[];
}