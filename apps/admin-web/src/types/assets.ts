export type AssetInspectionStatus = "COMPLETED" | "PENDING";

export interface AssetListItem {
  id: string;
  assetCode: string;
  assetType: string | null;
  feeder: string | null;
  location: string | null;
  pencawangName: string | null;
  inspectionStatus: AssetInspectionStatus;
  date: string | null;
  assetStatus?: string | null;
}

export interface AssetDetail extends AssetListItem {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  latestInspection: {
    id: string;
    cycleNumber: number | null;
    status: string | null;
    submittedAt: string | null;
    remarks?: string | null;
    images?: Array<{
      url: string;
    }>;
  } | null;
}
