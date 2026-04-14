require "pathutil"

class Pathutil
  def read(*args, **kwargs)
    File.read(self, *args, **kwargs)
  end

  def binread(*args, **kwargs)
    File.binread(self, *args, **kwargs)
  end
end
