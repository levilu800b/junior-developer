// GET /data, checked directly: the client's details must never leave the backend

const BACKEND_URL = "http://localhost:8000";

type Source = { id: string; source: string; favicon: string | null; citation: number | null };
type Item = { question: string; content: string; sources: Source[] };

describe("GET /data", () => {
  let items: Item[];

  before(() => {
    cy.request(`${BACKEND_URL}/data`).then((response) => {
      expect(response.status).to.eq(200);
      items = response.body;
    });
  });

  it("returns the four items", () => {
    expect(items).to.have.length(4);
  });

  it("never returns the client's name, email or phone number", () => {
    cy.fixture("personal-details.json").then((details: string[]) => {
      const response = JSON.stringify(items);
      details.forEach((detail) => expect(response).not.to.include(detail));
    });
  });

  it("replaces each detail with a placeholder", () => {
    items.forEach((item) => {
      expect(item.question).to.include("[NAME]");
      expect(item.question).to.include("[EMAIL]");
      expect(item.question).to.include("[PHONE]");
      expect(item.question).not.to.include("[NAME] [NAME]");
    });
  });

  it("replaces every ref with a link to one of the item's sources", () => {
    items.forEach((item) => {
      expect(item.content).not.to.include("<ref>");
      const urls = item.sources.map((source) => source.source);
      const hrefs = [...item.content.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
      expect(hrefs.length).to.be.greaterThan(0);
      hrefs.forEach((href) => expect(urls).to.include(href.replaceAll("&amp;", "&")));
    });
  });

  it("numbers the cited sources from 1, cited first then uncited", () => {
    items.forEach((item) => {
      const citations = item.sources.map((source) => source.citation);
      const cited = citations.filter((citation) => citation !== null);
      expect(cited).to.deep.eq(cited.map((_, index) => index + 1));
      expect(citations.slice(0, cited.length)).to.deep.eq(cited);
    });
  });

  it("gives every source a favicon", () => {
    items.forEach((item) =>
      item.sources.forEach((source) => expect(source.favicon).to.match(/^https:\/\//)),
    );
  });
});
