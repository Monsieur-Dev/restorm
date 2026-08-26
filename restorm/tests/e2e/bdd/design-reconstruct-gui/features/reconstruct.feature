Feature: Reconstruct the RealEstate design through the GUI

  Driving only the GUI (clicks + typed input + the Generate CRUD/Search
  buttons a user presses), rebuild the RealEstate design and assert it equals
  the golden — ids and templates aside.

  Scenario: The GUI-built design matches the golden
    Given restorm is launched blank for GUI reconstruction
    When I reconstruct the RealEstate design through the GUI
    Then the GUI-built design matches the golden except ids and templates
