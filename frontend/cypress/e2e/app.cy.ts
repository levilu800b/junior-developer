// The page, checked as an adviser would see it, against TASK.md's frontend list

const ITEM = '[data-testid="item"]';

describe("Answers page", () => {
  beforeEach(() => {
    cy.visit("/");
    cy.get(ITEM).should("have.length", 4);
  });

  describe("1. The redacted question", () => {
    it("doesn't show any of the client's details anywhere on the page", () => {
      cy.fixture("personal-details.json").then((details: string[]) => {
        cy.get("main")
          .invoke("text")
          .then((text) => details.forEach((detail) => expect(text).not.to.include(detail)));
      });
    });

    it("shows one [NAME] per name, even when the model finds a name more than once", () => {
      cy.get('[data-testid="question"]')
        .first()
        .should(
          "have.text",
          "My client [NAME] had her mobile phone stolen last Friday. What should she do? " +
            "[NAME]'s number is [PHONE] and her email is [EMAIL].",
        );
    });

    it("shows a placeholder for each kind of detail in every question", () => {
      cy.get('[data-testid="question"]').each(($question) => {
        expect($question.text()).to.include("[NAME]");
        expect($question.text()).to.include("[EMAIL]");
        expect($question.text()).to.include("[PHONE]");
      });
    });
  });

  describe("2. The answer, with working citation links", () => {
    it("has no raw <ref> tags left", () => {
      cy.get('[data-testid="answer"]').each(($answer) => {
        expect($answer.html()).not.to.include("<ref>");
        expect($answer.text()).not.to.include("<ref>");
      });
    });

    it("links each citation to the source with the same number", () => {
      cy.get(ITEM).each(($item) => {
        // The number shown next to each cited source, by its URL
        const numbers = new Map<string, string>();
        $item.find('[data-testid="cited-sources"] li').each((_, li) => {
          numbers.set(li.querySelector("a")!.getAttribute("href")!, li.querySelector("span")!.textContent!);
        });

        const links = $item.find('[data-testid="answer"] a');
        expect(links.length).to.be.greaterThan(0);
        links.each((_, link) => {
          const href = link.getAttribute("href")!;
          expect(href).to.match(/^https:\/\//);
          expect(link.textContent).to.eq(numbers.get(href));
          expect(link.getAttribute("target")).to.eq("_blank");
          expect(link.getAttribute("rel")).to.eq("noopener noreferrer");
        });
      });
    });

    it("links the debt answer's mistyped ref to the debt management plans source", () => {
      cy.get(ITEM)
        .eq(2)
        .find('[data-testid="answer"] a')
        .last()
        .should("have.text", "[2]")
        .and("have.attr", "href")
        .and("include", "debt-management-plans-what-you-need-to-know");
    });

    it("keeps the answer's bold text", () => {
      cy.get('[data-testid="answer"]').each(($answer) => {
        expect($answer.find("b").length).to.be.greaterThan(0);
      });
    });
  });

  describe("3. Every source, cited and not cited, with its favicon", () => {
    it("lists all four sources for each item, cited ones numbered from [1]", () => {
      cy.get(ITEM).each(($item) => {
        const cited = $item.find('[data-testid="cited-sources"] li');
        const uncited = $item.find('[data-testid="uncited-sources"] li');
        expect(cited.length + uncited.length).to.eq(4);
        expect(uncited.length).to.be.greaterThan(0);
        cited.each((index, li) => {
          expect(li.querySelector("span")!.textContent).to.eq(`[${index + 1}]`);
        });
      });
    });

    it("shows a favicon that has loaded for every source", () => {
      cy.get(`${ITEM} li img`).should("have.length", 16);
      // next/image lazy-loads, so scroll each favicon into view as an adviser would
      cy.get(`${ITEM} li img`).each(($img) => {
        cy.wrap($img).scrollIntoView().should(($loaded) => {
          expect(($loaded[0] as HTMLImageElement).naturalWidth).to.be.greaterThan(0);
        });
      });
    });
  });
});
