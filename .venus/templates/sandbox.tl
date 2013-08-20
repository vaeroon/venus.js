<!DOCTYPE html>
<html>
<head>
  <title>Venus Test Harness (Sandbox)</title>
  <link rel="stylesheet" type="text/css" href="/css/jasmine.css">
  <script type="text/javascript" src="/js/runner_client/console.log.js"></script>
  <script type="text/javascript">

      {clobContents|s}

  </script>
  {#scriptIncludes}
  <script type="text/javascript" src="{.}"></script>
  {/scriptIncludes}
</head>
<body>
  <script src="{testcaseFile}"></script>

  <script type="text/javascript">
    window.adaptor = new Adaptor();
    window.adaptor.start();
  </script>
</body>
</html>

