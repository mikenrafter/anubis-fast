{ pkgs, inputs, ... }:

{
  packages = [
    pkgs.go
    pkgs.nodejs_22
    pkgs.web-ext
    # The real challenge server for the live tests and README captures.
    pkgs.anubis
  ] ++ inputs.firefox-addon-live.lib.tools pkgs;

  git-hooks.hooks.anubis-fast-typecheck = {
    enable = true;
    name = "Anubis Fast TypeScript check";
    entry = "npm run typecheck";
    language = "system";
    pass_filenames = false;
    stages = [ "pre-commit" ];
  };

  # Firefox for the live tests, and the .firefox-addon-live link package.json uses.
  enterShell = inputs.firefox-addon-live.lib.shellHook pkgs + ''
    echo "Anubis Fast development environment ready"
    echo "Run: npm install && npm run check"
  '';
}
