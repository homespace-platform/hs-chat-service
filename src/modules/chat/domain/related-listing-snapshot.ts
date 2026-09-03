export interface RelatedListingSnapshot {
  id: string;
  title: string;
  price: string;
  location: string;
  image: string;
  bedrooms?: number;
  area?: number;
  verified?: boolean;
}
