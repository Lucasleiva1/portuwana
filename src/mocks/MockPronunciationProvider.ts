export interface MockPronunciationResult {
  status: "mock";
  message: string;
}

export class MockPronunciationProvider {
  async assess(): Promise<MockPronunciationResult> {
    return {
      status: "mock",
      message: "A avaliação de pronúncia real será conectada em uma etapa futura.",
    };
  }
}
