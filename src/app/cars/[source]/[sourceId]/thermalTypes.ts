export type ThermalEntry = {
  url: string;
  type: string;
  width: number | null;
  height: number | null;
  boxes: Array<{
    part: string | null;
    box: [number, number, number, number];
  }>;
};

export type ThermalReference = {
  url: string;
};
