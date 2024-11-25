export interface OutputVideo {
  scenes: OutputScene[];
}
interface OutputScene {
  description: string;
  lengthSeconds: number;
  captions: OutputCaption[];
  // the video file, the start time of where we cut in the video
}
interface OutputCaption {
  caption: string;
  color: "red" | "green" | "blue" | "yellow" | "magenta" | "cyan" | "white";
}