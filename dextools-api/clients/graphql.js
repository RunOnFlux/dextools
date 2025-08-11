const { GraphQLClient, gql } = require("graphql-request");

const endpoint =
  process.env.KADENA_INDEXER_GRAPHQL_URL || "https://kadindexer.com/graphql";

const client = new GraphQLClient(endpoint, {
  headers: {
    ...(process.env.KADENA_INDEXER_API_KEY && {
      "x-api-key": process.env.KADENA_INDEXER_API_KEY,
    }),
  },
});

const GET_ACCOUNT_TRANSACTIONS = gql`
  query GetAccountTransactions(
    $accountName: String!
    $first: Int
    $after: String
  ) {
    transfers(accountName: $accountName, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          creationTime
          amount
          moduleName
          requestKey
          senderAccount
          receiverAccount
          transaction {
            result {
              ... on TransactionResult {
                block {
                  chainId
                }
                gas
                continuation
                badResult
                goodResult
              }
            }
            cmd {
              payload {
                ... on ExecutionPayload {
                  code
                }
              }
              meta {
                creationTime
                gasLimit
                gasPrice
              }
            }
          }
        }
      }
    }
  }
`;

module.exports = {
  client,
  GET_ACCOUNT_TRANSACTIONS,
};
