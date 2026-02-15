# AI Code Reviewer GitHub Action

![AI Generated](https://ai-percentage-pin.vercel.app/api/ai-percentage?value=50)
![AI PRs Welcome](https://ai-percentage-pin.vercel.app/api/ai-prs?welcome=yes)

A GitHub Action that uses OpenAI to review Pull Requests.

**Current Status**: Test Version (posts inline comments on each changed diff line in the PR).

## Landing Page

This repo now includes a landing page template as a git submodule:

- `landing-page` -> [Start Bootstrap Landing Page](https://github.com/StartBootstrap/startbootstrap-landing-page)
- Customized file: `landing-page/dist/index.html`

### Preview Locally

```bash
git submodule update --init --recursive
python3 -m http.server 4173 --directory landing-page/dist
```

Open `http://localhost:4173`.

## Usage

To use this action in your workflow, add the following step:

```yaml
name: AI Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: AI Code Reviewer
        uses: ./ # If using from the same repo, otherwise use owner/repo@version
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          model: 'gpt-4-turbo' # Optional, default is gpt-4-turbo
```

## Use in the Same Repository (No Hosting Required)

If you don't want to create a separate repository for this action, you can include it directly in your main repository.

1.  **Copy Files**: Move this entire `code-reviewer` folder into your repository, for example to `.github/actions/code-reviewer`.
2.  **Commit**: Commit the `action.yml` and the `dist/index.js` file.
3.  **Update Workflow**: Point your workflow to the local path.

```yaml
      - name: AI Code Reviewer
        uses: ./.github/actions/code-reviewer # Path to the action folder
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## How to Host / Publish

To make this action available for use in other repositories, you simply need to push it to GitHub.

1.  **Create a Repository**: Create a new public repository on GitHub (e.g., `my-ai-reviewer`).
2.  **Push Code**: Push all files, **including the `dist` folder**, to this repository.
    ```bash
    git init
    git add .
    git commit -m "Initial release"
    git branch -M main
    git remote add origin https://github.com/YOUR_USERNAME/my-ai-reviewer.git
    git push -u origin main
    ```
3.  **Tag a Release** (Recommended): Create a tag so users can reference a stable version.
    ```bash
    git tag -a v1 -m "First version"
    git push origin v1
    ```
4.  **Use It**: In any other repository, you can now use your action:
    ```yaml
    uses: YOUR_USERNAME/my-ai-reviewer@v1
    ```

### Publishing to GitHub Marketplace

If you want to make your action easily discoverable by others:

1.  Go to your repository on GitHub.
2.  You will see a banner "Draft a release".
3.  Click "Draft a release".
4.  Check the box "Publish this Action to the GitHub Marketplace".
5.  Follow the instructions to set a category and icon (you can customize branding in `action.yml`).

## Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `openai_api_key` | Your OpenAI API Key | No | N/A |
| `github_token` | GitHub Token (usually `${{ github.token }}`) | Yes | `${{ github.token }}` |
| `model` | OpenAI Model to use | No | `gpt-4-turbo` |

## Development

### Install Dependencies

```bash
npm install
```

### Build

Compile the TypeScript code into a single JavaScript file:

```bash
npm run build
```

The output will be in `dist/index.js`.

### Project Structure

- `src/`: TypeScript source code.
- `dist/`: Compiled JavaScript code (do not edit manually).
- `action.yml`: Action metadata.

## Boilerplate Info

This project follows the standard TypeScript GitHub Action structure:
- `npm init` for Node.js setup.
- `@actions/core` and `@actions/github` for the toolkit.
- `@vercel/ncc` for bundling the action into a single file.


## Notes
Main components of the project:

- Interaction with git and git clients
  - getting the diff, history, PR, files etc. Adding comments, CI/CD etc.
  - Setting up github actions

- Code Review
  - Actual code review logic
  - ability to set custom high amounts of rules repo and org level  
  - indexing the code, making sense of things