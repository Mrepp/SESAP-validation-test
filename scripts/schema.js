export const interviewSchema = {
  type: "object",
  required: ["interviewId", "analysis", "metadata"],
  properties: {
    interviewId: { type: "string" },
    intervieweeName: { type: "string" },
    interviewDate: { type: "string" },
    interviewFormat: { type: "string" },
    interviewerName: { type: "string" },
    demographics: {
      type: "object",
      properties: {
        age: { type: "string" },
        gender: { type: "string" },
        major: { type: "string" },
        year: { type: "string" },
        other: { type: "string" }
      }
    },
    transcript: {
      type: "object",
      properties: {
        fileName: { type: "string" },
        fileType: { type: "string" },
        rawText: { type: "string" },
        wordCount: { type: "number" },
        validation: {
          type: "object",
          properties: {
            minimumLengthCheck: {
              type: "object",
              properties: {
                passed: { type: "boolean" },
                warningIssued: { type: "boolean" },
                overrideApprovedBy: { type: "string" }
              }
            }
          }
        }
      }
    },
    analysis: {
      type: "object",
      required: ["summaries", "themes", "quotes"],
      properties: {
        model: {
          type: "object",
          properties: {
            provider: { type: "string" },
            modelName: { type: "string" },
            temperature: { type: "number" },
            promptVersion: { type: "string" },
            promptTemplateId: { type: "string" }
          }
        },
        summaries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              title: { type: "string" },
              summaryText: { type: "string" },
              embedding: { type: "array", items: { type: "number" } }
            }
          }
        },
        timelinePoints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              eventDescription: { type: "string" },
              timeframeType: { type: "string" },
              category: { type: "string" },
              sentiment: { type: "string" },
              embedding: { type: "array", items: { type: "number" } }
            }
          }
        },
        themes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              themeId: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              frequency: { type: "number" },
              impactScore: { type: "number" },
              actionable: { type: "boolean" },
              category: { type: "string" },
              relatedQuoteIds: { type: "array", items: { type: "string" } },
              embedding: { type: "array", items: { type: "number" } }
            }
          }
        },
        quotes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              quoteId: { type: "string" },
              quoteText: { type: "string" },
              context: { type: "string" },
              timestamp: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              sentiment: { type: "string" },
              significanceLevel: { type: "string" },
              relatedThemeIds: { type: "array", items: { type: "string" } },
              embedding: { type: "array", items: { type: "number" } }
            }
          }
        },
        areasForImprovement: {
          type: "array",
          items: {
            type: "object",
            properties: {
              areaId: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              priority: { type: "string" },
              stakeholders: { type: "array", items: { type: "string" } },
              actionItems: { type: "array", items: { type: "string" } },
              embedding: { type: "array", items: { type: "number" } }
            }
          }
        }
      }
    },
    metadata: {
      type: "object",
      properties: {
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        version: { type: "string" },
        source: { type: "string" },
        validatedBy: { type: "string" }
      }
    }
  }
};