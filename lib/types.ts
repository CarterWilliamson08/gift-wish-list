export type ProductHit = {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  url: string;
  image?: string | null;
  retailer: string;
  asin?: string | null;
};

export type RetailerOffer = {
  retailer: string;
  price: number | null;
  currency: string;
  url: string;
};

export type WishItem = {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  url: string;
  image?: string | null;
  asin?: string | null;
  addedAt: string;
  offers?: RetailerOffer[];
};

export type ApiMeta = {
  sample: boolean;
  message?: string;
};
