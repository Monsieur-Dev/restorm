const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');

// Sample data
const users = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
  { id: '3', name: 'Charlie', email: 'charlie@example.com' },
];

const posts = [
  { id: '1', title: 'Hello GraphQL', content: 'GraphQL is awesome!', authorId: '1' },
  { id: '2', title: 'Testing APIs', content: 'Testing is important.', authorId: '2' },
  { id: '3', title: 'Docker Tips', content: 'Containers are great.', authorId: '1' },
];

// Schema
const typeDefs = `
  type User {
    id: ID!
    name: String!
    email: String!
    posts: [Post!]!
  }

  type Post {
    id: ID!
    title: String!
    content: String!
    author: User!
  }

  type Query {
    users: [User!]!
    user(id: ID!): User
    posts: [Post!]!
    post(id: ID!): Post
    echo(message: String!): String!
  }

  type Mutation {
    createUser(name: String!, email: String!): User!
    createPost(title: String!, content: String!, authorId: ID!): Post!
    deleteUser(id: ID!): Boolean!
    deletePost(id: ID!): Boolean!
  }

  type Subscription {
    postCreated: Post!
  }
`;

// Resolvers
const resolvers = {
  Query: {
    users: () => users,
    user: (_, { id }) => users.find((u) => u.id === id),
    posts: () => posts,
    post: (_, { id }) => posts.find((p) => p.id === id),
    echo: (_, { message }) => `Echo: ${message}`,
  },
  Mutation: {
    createUser: (_, { name, email }) => {
      const user = { id: String(users.length + 1), name, email };
      users.push(user);
      return user;
    },
    createPost: (_, { title, content, authorId }) => {
      const post = { id: String(posts.length + 1), title, content, authorId };
      posts.push(post);
      return post;
    },
    deleteUser: (_, { id }) => {
      const index = users.findIndex((u) => u.id === id);
      if (index === -1) return false;
      users.splice(index, 1);
      return true;
    },
    deletePost: (_, { id }) => {
      const index = posts.findIndex((p) => p.id === id);
      if (index === -1) return false;
      posts.splice(index, 1);
      return true;
    },
  },
  User: {
    posts: (user) => posts.filter((p) => p.authorId === user.id),
  },
  Post: {
    author: (post) => users.find((u) => u.id === post.authorId),
  },
};

async function startServer() {
  const server = new ApolloServer({ typeDefs, resolvers });
  const { url } = await startStandaloneServer(server, {
    listen: { port: 4000, host: '0.0.0.0' },
  });
  console.log(`GraphQL server ready at ${url}`);
}

startServer();
