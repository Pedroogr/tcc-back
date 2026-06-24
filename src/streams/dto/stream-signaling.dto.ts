export type StreamSignalDescription = {
  type: string;
  sdp?: string;
};

export type StreamIceCandidate = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type BroadcasterJoinPayload = {
  auctionId: string;
};

export type ViewerJoinPayload = {
  auctionId: string;
};

export type StreamOfferPayload = {
  auctionId: string;
  targetId: string;
  sdp: StreamSignalDescription;
};

export type StreamAnswerPayload = {
  auctionId: string;
  targetId: string;
  sdp: StreamSignalDescription;
};

export type StreamIceCandidatePayload = {
  auctionId: string;
  targetId: string;
  candidate: StreamIceCandidate;
};
