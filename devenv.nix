{ pkgs, ... }:

{
  packages = [
    pkgs.go
    pkgs.nodejs_22
    pkgs.web-ext
  ];

  git-hooks.hooks.anubis-fast-typecheck = {
    enable = true;
    name = "Anubis Fast TypeScript check";
    entry = "npm run typecheck";
    language = "system";
    pass_filenames = false;
    stages = [ "pre-commit" ];
  };

  enterShell = ''
    echo "Anubis Fast development environment ready"
    echo "Run: npm install && npm run check"
  '';
}
